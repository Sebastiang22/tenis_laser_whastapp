const axios = require('axios');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, downloadMediaMessage } = require('@whiskeysockets/baileys');
const log = (pino = require('pino'));
const { Boom } = require('@hapi/boom');
const dayjs = require('dayjs');
const schedule = require('node-schedule');

// Variables globales
let sock;

const reconnectionDelay = 1; // Retraso fijo de 5 segundos entre reintentos

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth_info');

    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: log({ level: 'silent' }),
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('Nuevo QR:', qr);
        }

        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error).output.statusCode;
            console.log(`Conexión cerrada. Razón: ${reason}`);

            switch (reason) {
                case DisconnectReason.badSession:
                    console.log('Archivo de sesión incorrecto. Elimina y escanea de nuevo.');
                    sock.logout();
                    break;
                case DisconnectReason.connectionClosed:
                case DisconnectReason.connectionLost:
                case DisconnectReason.timedOut:
                case 503: // Caso específico para manejar errores 503
                    console.log('Problema de conexión. Intentando reconectar...');
                    await reconnectIndefinitely();
                    break;
                case DisconnectReason.connectionReplaced:
                    console.log('Conexión reemplazada. Cierra la sesión actual primero.');
                    sock.logout();
                    break;
                case DisconnectReason.loggedOut:
                    console.log('Cerrado de sesión. Elimina el archivo de sesión y escanea de nuevo.');
                    sock.logout();
                    break;
                case DisconnectReason.restartRequired:
                    console.log('Reinicio requerido, reiniciando...');
                    await reconnectIndefinitely();
                    break;
                default:
                    console.log(`Razón de desconexión desconocida: ${reason} | ${lastDisconnect?.error}`);
                    await reconnectIndefinitely();
            }
        } else if (connection === 'open') {
            console.log('Conexión establecida exitosamente.');
        }
    });

    // Manejar mensajes entrantes (texto e imagen)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        try {
            if (type === 'notify' && messages.length > 0) {
                const message = messages[0];
                const { key, message: msg } = message;
                const { remoteJid } = key;
                const senderNumber = remoteJid.split('@')[0]; // Extraer el número del remitente
                const messageType = Object.keys(msg)[0]; // Tipo de mensaje (texto, imagen, etc.)

                let textMessage = '';
                let imageBuffer = null;

                if (messageType === 'conversation' || messageType === 'extendedTextMessage') {
                    // Es un mensaje de texto
                    textMessage = msg.conversation || msg.extendedTextMessage?.text;
                    console.log('Número del remitente:', senderNumber);
                    console.log('Mensaje recibido:', textMessage);
                } else if (messageType === 'imageMessage') {
                    // Es un mensaje de imagen
                    textMessage = 'imagen'; // Mensaje predeterminado para imágenes
                    console.log('Número del remitente:', senderNumber);
                    console.log('Imagen recibida');

                    try {
                        // Obtener la imagen del mensaje
                        imageBuffer = await downloadMediaMessage(message, 'buffer', {}, {
                            reuploadRequest: sock.updateMediaMessage // Para re-subir si es necesario
                        });
                    } catch (error) {
                        console.error('Error al obtener la imagen:', error); // Usar console.error para mejor debug
                        await sock.sendMessage(remoteJid, { text: 'Hubo un error al procesar la imagen.' }, { quoted: message });
                        return;
                    }
                }

                // Agregar lógica para manejar mensajes de texto solo si no son del bot
                if (textMessage && !key.fromMe) { 

                    // Crear datos del cuerpo de la solicitud POST
                    const requestBody = {
                        mensaje: textMessage,
                        celular: senderNumber
                    };

                    if (imageBuffer) {
                        // Convertir el buffer de la imagen a hexadecimal
                        requestBody.imagen = imageBuffer.toString('hex'); // Convertir a hex en lugar de base64
                    }

                    // Enviar una solicitud POST al servidor
                    try {
                        const response = await axios.post(
                            'http://localhost:7071/api/chatbot',
                            requestBody, // Enviar texto e imagen en el cuerpo
                            {
                                headers: {
                                    'Content-Type': 'application/json'
                                }
                            }
                        );
                        const responseData = response.data;
                    
                        if (responseData) {
                            // Responder con la respuesta del servidor si no está vacío
                            await sock.sendMessage(remoteJid, { text: String(responseData) }, { quoted: message });
                            console.log('Respuesta enviada de vuelta:', responseData);
                        } else {
                            console.log('No hay respuesta para enviar.');
                        }
                    } catch (error) {
                        console.error('Error en la solicitud POST:', error); // Usar console.error para mejor información
                        await sock.sendMessage(remoteJid, { text: 'Hubo un error al procesar tu solicitud.' }, { quoted: message });
                    }                    
                }    
            }
        } catch (error) {
            console.error('Error manejando el mensaje:', error); // Mejor uso de console.error para el logging
        }
    });

    // Guardar credenciales actualizadas
    sock.ev.on('creds.update', saveCreds);
}

// Función para reconectar indefinidamente con retraso
async function reconnectIndefinitely() {
    console.log(`Intentando reconectar en ${reconnectionDelay / 1000} segundos...`);
    await new Promise(resolve => setTimeout(resolve, reconnectionDelay));
    await connectToWhatsApp(); // Llama a la función principal de conexión para reintentar indefinidamente
}

// Función principal para iniciar la conexión y enviar mensajes
async function main() {
    try {
      await connectToWhatsApp();
      
    } catch (err) {
      console.log('Unexpected error:', err);
    }
}
  
// Ejecutar la función principal
main();
