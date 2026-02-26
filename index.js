require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

const delay = ms => new Promise(res => setTimeout(res, ms));
const lastMessageTime = new Map();
const userState = new Map(); 

function isSpamming(user) {
    const now = Date.now();
    const last = lastMessageTime.get(user) || 0;
    lastMessageTime.set(user, now);
    return now - last < 1200;
}

function getBestMatch(input) {
    const text = input.toLowerCase();
    if (/(asesor|humano|persona|hablar con alguien|ayuda|vendedor|contacto)/.test(text)) return '5';
    if (/(precio|cuanto cuesta|cotizeme|cotizar|cotizacion|valor)/.test(text)) return '1';
    if (/(mi pedido|donde esta|rastreo|compra|mi producto|llego)/.test(text)) return '2';
    if (/(catalogo|productos|lista|ver productos)/.test(text)) return '3';
    if (/(donde quedan|donde estan|ubicacion|direccion|horario|sede|local|tienda)/.test(text)) return '4';
    return null;
}

async function askOpenRouter(question) {
    const models = ["google/gemini-2.0-flash-001", "mistralai/mistral-7b-instruct"];
    for (const model of models) {
        try {
            const response = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
                model,
                messages: [
                    {
                        role: "system",
                        content: "Eres Jorge, asesor experto de Sika Center Edificando. Responde de manera formal sobre productos Sika, Soudal, Mapei, entre otras marcas. Si es otro tema, pide amablemente que pregunten sobre construcción o marquen la opción 5."
                    },
                    { role: "user", content: question }
                ],
            }, {
                headers: {
                    "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    "Content-Type": "application/json"
                },
                timeout: 10000
            });

            return response.data.choices[0].message.content;
        } catch {
            console.log("⚠️ Error IA con modelo:", model);
        }
    }
    return "🤖 Estoy un poco lento ahora mismo. Escribe *5* para hablar con un asesor humano.";
}

async function notifyHumanAdvisor(client, realPhone, lastMessage) {
    const advisorJid = process.env.ASESOR_PHONE + "@c.us";
    const clean = realPhone.replace('+', '');

    const text = 
    `🚨 *Nuevo cliente solicita ASESORIA PERSONALIZADA*

    📞 *Cliente:* ${realPhone}
    🔗 *WhatsApp:* https://wa.me/${clean}
    💬 *Mensaje:* ${lastMessage}
    🕒 *Hora:* ${new Date().toLocaleString()}

    👉 Escríbele directamente por WhatsApp.`;

    await client.sendMessage(advisorJid, text);
}

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ Jorge Sika Center Online (Privacidad Activada)'));

client.on('message', async (msg) => {
    try {
        if (msg.from === 'status@broadcast') return;
        if (msg.fromMe) return;

        const chat = await msg.getChat();
        if (chat.isGroup) return;

        if (isSpamming(msg.from)) return;

        const userMessage = msg.body?.trim();
        if (!userMessage) return;

        const userMessageLC = userMessage.toLowerCase();

        if (userState.get(msg.from) === 'awaiting_phone') {
            const phone = userMessage.replace(/\s+/g, '');
            const peruRegex = /^\+51\d{9}$/;

            if (!peruRegex.test(phone)) {
                return msg.reply('❌ Número inválido.\nEjemplo correcto: +51987654321');
            }

            await notifyHumanAdvisor(client, phone, "Solicitó asesor humano");
            userState.delete(msg.from);

            return msg.reply('✅ Gracias. Un asesor humano te escribirá en breve 🙌');
        }

        const triggers = ['hola', 'buenos dias', 'buenas tardes', 'información', 'info', 'sika', 'Hola *Sika Center*. Necesito más información sobre Sika Center https://sikacenter.com.pe/'];
        if (triggers.some(t => userMessageLC.includes(t)) && userMessage.length < 20) {
            await chat.sendStateTyping();
            await delay(500);
            return msg.reply(
            `👋 *Hola! Soy Jorge, asesor de Edificando*

            1️⃣ *COTIZACIONES*  
            2️⃣ *PEDIDOS*  
            3️⃣ *PRODUCTOS*  
            4️⃣ *UBICACIÓN*  
            5️⃣ *ASESORIA PERSONALIZADA*

            Escribe el número de las opciones o tu duda técnica con respecto a los productos.`);
        }

        const menuOptions = {
            '1': '📝 *COTIZACIONES*: Indícanos para que localidad y/o ciudad lo requiere, quedo atento a tu respuesta.',
            '2': '📦 *PEDIDOS*: Envíanos tu número de orden o DNI.',
            '3': '🏗️ *PRODUCTOS*: https://sikacenter.com.pe/',
            '4': '📍 *UBICACIÓN*: Av. Masiche 2240, Trujillo L-V 8:30am a 6pm, Sáb 8:30am a 1pm.',
            '5': async () => {
                userState.set(msg.from, 'awaiting_phone');
                await msg.reply(
                    '👤 Para derivarte con un asesor humano, envíame tu *número de celular con código de país*.\n\nEjemplo: +51987654321'
                );
            }
        };

        const matchedOption = getBestMatch(userMessageLC);
        const finalOption = menuOptions[userMessage] ? userMessage : matchedOption;

        if (finalOption) {
            await chat.sendStateTyping();
            await delay(500);

            if (typeof menuOptions[finalOption] === 'function') {
                return menuOptions[finalOption]();
            }

            return msg.reply(menuOptions[finalOption]);
        }

        if (userMessage.length > 4) {
            await chat.sendStateTyping();
            const aiResponse = await askOpenRouter(userMessage);
            return client.sendMessage(msg.from, `🤖 *Asesor Jorge:*\n\n${aiResponse}`);
        } 

    } catch (err) {
        console.error('💥 Error en mensaje:', err);
        try {
            await msg.reply('⚠️ Ocurrió un error. Escribe *hola* para ver el menú.');
        } catch {}
    }
}); 

client.initialize();