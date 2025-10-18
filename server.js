const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

// Configuración de MySQL
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'kbjebqmy_jornada',
    password: process.env.DB_PASSWORD || 'Abetnegoxyz1965$',
    database: process.env.DB_NAME || 'kbjebqmy_optica_jornadas',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Cliente de WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Estado del bot
let botReady = false;

// Evento: Generar QR
client.on('qr', (qr) => {
    console.log('📱 ESCANEA ESTE QR CON TU CELULAR:');
    qrcode.generate(qr, { small: true });
    console.log('\n\n🔗 O ABRE ESTE LINK EN TU NAVEGADOR:\n');
    console.log('https://qr.link/create?data=' + encodeURIComponent(qr));
    console.log('\n');
    console.log('\n🔹 Abre WhatsApp en tu celular Android');
    console.log('🔹 Ve a Ajustes > Dispositivos vinculados');
    console.log('🔹 Escanea el código QR de arriba\n');
});

// Evento: Cliente listo
client.on('ready', () => {
    console.log('✅ Bot de WhatsApp conectado y listo!');
    botReady = true;
    
    // Iniciar proceso de envío automático
    setInterval(procesarColaMensajes, 10000); // Cada 10 segundos
});

// Evento: Autenticación exitosa
client.on('authenticated', () => {
    console.log('🔐 Autenticación exitosa');
});

// Evento: Error de autenticación
client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación:', msg);
});

// Evento: Desconexión
client.on('disconnected', (reason) => {
    console.log('⚠️ Cliente desconectado:', reason);
    botReady = false;
});

// Inicializar cliente
client.initialize();

/**
 * Procesar cola de mensajes pendientes
 */
async function procesarColaMensajes() {
    if (!botReady) {
        console.log('⏳ Bot aún no está listo...');
        return;
    }

    try {
        const connection = await pool.getConnection();
        
        // Obtener mensajes pendientes
        const [mensajes] = await connection.query(
            'SELECT * FROM whatsapp_queue WHERE enviado = 0 ORDER BY fecha_creacion ASC LIMIT 10'
        );

        if (mensajes.length > 0) {
            console.log(`📨 Procesando ${mensajes.length} mensajes pendientes...`);
        }

        for (const msg of mensajes) {
            try {
                await enviarMensajeWhatsApp(msg.numero_destino, msg.mensaje);
                
                // Marcar como enviado
                await connection.query(
                    'UPDATE whatsapp_queue SET enviado = 1, fecha_envio = NOW() WHERE id = ?',
                    [msg.id]
                );
                
                console.log(`✅ Mensaje enviado a ${msg.numero_destino}`);
                
                // Esperar 2 segundos entre mensajes para evitar spam
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                console.error(`❌ Error al enviar mensaje ID ${msg.id}:`, error.message);
                
                // Marcar como enviado con error para no reintentarlo indefinidamente
                await connection.query(
                    'UPDATE whatsapp_queue SET enviado = -1, fecha_envio = NOW() WHERE id = ?',
                    [msg.id]
                );
            }
        }

        connection.release();

    } catch (error) {
        console.error('❌ Error al procesar cola:', error);
    }
}

/**
 * Enviar mensaje de WhatsApp
 */
async function enviarMensajeWhatsApp(numero, mensaje) {
    // Formatear número (eliminar caracteres especiales)
    let numeroLimpio = numero.replace(/\D/g, '');
    
    // Agregar código de país si no lo tiene (asumiendo República Dominicana +1-809)
    if (numeroLimpio.length === 10) {
        numeroLimpio = '1' + numeroLimpio;
    }
    
    // Formato para WhatsApp: [código_país][número]@c.us
    const chatId = numeroLimpio + '@c.us';
    
    await client.sendMessage(chatId, mensaje);
}

/**
 * API REST para enviar mensajes directos
 */
app.post('/api/send-message', async (req, res) => {
    const { numero, mensaje } = req.body;

    if (!numero || !mensaje) {
        return res.status(400).json({ 
            success: false, 
            error: 'Falta número o mensaje' 
        });
    }

    if (!botReady) {
        return res.status(503).json({ 
            success: false, 
            error: 'Bot no está conectado' 
        });
    }

    try {
        await enviarMensajeWhatsApp(numero, mensaje);
        res.json({ success: true, message: 'Mensaje enviado' });
    } catch (error) {
        console.error('Error al enviar mensaje:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

/**
 * Endpoint de salud
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        botReady: botReady,
        timestamp: new Date().toISOString()
    });
});

/**
 * Endpoint principal
 */
app.get('/', (req, res) => {
    res.json({
        service: 'WhatsApp Bot - Sistema de Notificaciones',
        status: botReady ? 'Conectado' : 'Desconectado',
        version: '1.0.0'
    });
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
});
