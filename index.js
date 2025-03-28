require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const https = require('https');

// Inicializa o bot com o token
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Função para verificar se um IP pertence à Cloudflare
async function isCloudflare(ip) {
    try {
        const response = await axios.get('https://www.cloudflare.com/ips-v4');
        const cloudflareRanges = response.data.split('\n').filter(Boolean);
        
        return cloudflareRanges.some(range => {
            const [network, bits] = range.split('/');
            const mask = ~((1 << (32 - bits)) - 1);
            const ipParts = ip.split('.').map(Number);
            const networkParts = network.split('.').map(Number);
            
            const ipNum = (ipParts[0] << 24) + (ipParts[1] << 16) + (ipParts[2] << 8) + ipParts[3];
            const networkNum = (networkParts[0] << 24) + (networkParts[1] << 16) + (networkParts[2] << 8) + networkParts[3];
            
            return (ipNum & mask) === (networkNum & mask);
        });
    } catch (error) {
        console.error('Erro ao verificar Cloudflare:', error);
        return false;
    }
}

// Função para verificar outras CDNs comuns
async function checkOtherCDNs(ip) {
    const cdnPatterns = {
        'Akamai': /(akamai|akam)/i,
        'Fastly': /(fastly)/i,
        'Amazon CloudFront': /(cloudfront|amazon)/i,
        'Google Cloud CDN': /(google|googleusercontent)/i,
        'Microsoft Azure CDN': /(azure|msedge)/i
    };

    try {
        const hostnames = await dns.reverse(ip);
        
        for (const [cdn, pattern] of Object.entries(cdnPatterns)) {
            if (hostnames.some(hostname => pattern.test(hostname))) {
                return { cdn };
            }
        }
        
        return { cdn: null };
    } catch (error) {
        console.error('Erro ao verificar outras CDNs:', error);
        return { cdn: null };
    }
}

// Função para obter informações de localização do IP
async function getIPLocation(ip) {
    try {
        const response = await axios.get(`http://ip-api.com/json/${ip}`);
        return response.data;
    } catch (error) {
        console.error('Erro ao obter localização do IP:', error);
        return null;
    }
}

// Função para verificar porta
function checkPort(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(5000);

        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });

        socket.on('error', () => {
            socket.destroy();
            resolve(false);
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });

        socket.connect(port, host);
    });
}

// Função para verificar certificado SSL
async function checkSSL(domain) {
    return new Promise((resolve) => {
        const options = {
            host: domain,
            port: 443,
            method: 'GET',
            rejectUnauthorized: false,
        };

        const req = https.request(options, (res) => {
            const cert = res.socket.getPeerCertificate();
            resolve({
                issuer: cert.issuer?.O || 'N/A',
                validTo: new Date(cert.valid_to).toLocaleDateString('pt-BR'),
                validFrom: new Date(cert.valid_from).toLocaleDateString('pt-BR')
            });
        });

        req.on('error', () => {
            resolve(null);
        });

        req.end();
    });
}

// Função para verificar certificado SNI
async function checkSNICertificate(domain) {
    return new Promise((resolve) => {
        const options = {
            host: domain,
            port: 443,
            method: 'GET',
            servername: domain, // Isso força o uso de SNI
            rejectUnauthorized: false,
        };

        const req = https.request(options, (res) => {
            const cert = res.socket.getPeerCertificate();
            resolve({
                issuer: cert.issuer?.O || 'N/A',
                validTo: new Date(cert.valid_to).toLocaleDateString('pt-BR'),
                validFrom: new Date(cert.valid_from).toLocaleDateString('pt-BR'),
                subjectAltNames: cert.subjectaltname ? cert.subjectaltname.split(', ').map(san => san.replace(/DNS:|IP Address:/g, '')) : [],
                subject: cert.subject?.CN || 'N/A'
            });
        });

        req.on('error', () => {
            resolve(null);
        });

        req.end();
    });
}

// Função para resolver domínio para IP
async function resolveDomain(domain) {
    try {
        const ips = await dns.resolve4(domain);
        return ips;
    } catch (error) {
        console.error('Erro ao resolver domínio:', error);
        return null;
    }
}

// Função para verificar status HTTP
async function checkHttpStatus(domain) {
    const urls = [
        `https://${domain}`,
        `http://${domain}`
    ];

    for (const url of urls) {
        try {
            const response = await axios.get(url, {
                maxRedirects: 5,
                timeout: 5000,
                validateStatus: false
            });
            return {
                url,
                status: response.status,
                protocol: url.split(':')[0].toUpperCase()
            };
        } catch (error) {
            console.error(`Erro ao verificar ${url}:`, error.message);
            continue;
        }
    }
    return null;
}

// Função para obter emoji do status HTTP
function getStatusEmoji(status) {
    if (status >= 200 && status < 300) return '✅';
    if (status >= 300 && status < 400) return '↪️';
    if (status >= 400 && status < 500) return '⚠️';
    if (status >= 500) return '❌';
    return '❓';
}

// Função para obter descrição do status HTTP
function getStatusDescription(status) {
    const statusDescriptions = {
        200: 'OK',
        201: 'Created',
        301: 'Moved Permanently',
        302: 'Found',
        304: 'Not Modified',
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        500: 'Internal Server Error',
        502: 'Bad Gateway',
        503: 'Service Unavailable',
        504: 'Gateway Timeout'
    };
    return statusDescriptions[status] || 'Unknown Status';
}

// Função para verificar se a mensagem é de um grupo
function isGroupMessage(msg) {
    return msg.chat.type === 'group' || msg.chat.type === 'supergroup';
}

// Comando /start
bot.onText(/\/start(@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;
    const isGroup = isGroupMessage(msg);
    const helpMessage = `🤖 Bem-vindo ao VPN Checker Bot!

Comandos disponíveis:
${isGroup ? '/check@scannerssh_bot [domínio]' : '/check [domínio]'} - Verifica informações do domínio
${isGroup ? '/help@scannerssh_bot' : '/help'} - Mostra esta mensagem de ajuda

Exemplo:
${isGroup ? '/check@scannerssh_bot google.com' : '/check google.com'}`;
    
    bot.sendMessage(chatId, helpMessage);
});

// Comando /help
bot.onText(/\/help(@\w+)?$/, (msg) => {
    const chatId = msg.chat.id;
    const isGroup = isGroupMessage(msg);
    const helpMessage = `🤖 VPN Checker Bot - Comandos:

${isGroup ? '/check@scannerssh_bot [domínio]' : '/check [domínio]'} - Verifica informações do domínio
${isGroup ? '/help@scannerssh_bot' : '/help'} - Mostra esta mensagem de ajuda

Exemplo:
${isGroup ? '/check@scannerssh_bot google.com' : '/check google.com'}`;
    
    bot.sendMessage(chatId, helpMessage);
});

// Função para validar domínio
function isValidDomain(domain) {
    const domainPattern = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    return domainPattern.test(domain);
}

// Função para analisar IP
async function analyzeIP(ip) {
    const isCloudflareIP = await isCloudflare(ip);
    const { cdn: otherCDN } = await checkOtherCDNs(ip);
    
    if (isCloudflareIP) {
        return 'Cloudflare';
    } else if (otherCDN) {
        return otherCDN;
    }
    return null;
}

// Função para verificar servidor em diferentes regiões
async function checkServerRegions(domain) {
    const regions = {
        'América do Norte': 'https://us-east.cloudflare-speedtest.com',
        'Europa': 'https://eu-central.cloudflare-speedtest.com',
        'Ásia': 'https://asia-east.cloudflare-speedtest.com',
        'América do Sul': 'https://sa-east.cloudflare-speedtest.com'
    };

    const results = {};
    for (const [region, proxyUrl] of Object.entries(regions)) {
        try {
            const response = await axios.get(`${proxyUrl}/check?domain=${domain}`, {
                timeout: 5000,
                validateStatus: false
            });
            results[region] = response.status < 400;
        } catch (error) {
            results[region] = false;
        }
    }
    return results;
}

// Função para verificar tipo de hosting
async function checkHostingType(ip) {
    try {
        const response = await axios.get(`https://ipapi.co/${ip}/json/`);
        const data = response.data;
        
        // Análise do tipo de hosting baseado em padrões comuns
        const hostingPatterns = {
            'AWS': /(amazon|aws)/i,
            'Google Cloud': /(google|googlecloud)/i,
            'Azure': /(microsoft|azure|msft)/i,
            'DigitalOcean': /(digitalocean)/i,
            'Linode': /(linode)/i,
            'OVH': /(ovh)/i,
            'Vultr': /(vultr)/i,
            'Hetzner': /(hetzner)/i
        };

        for (const [provider, pattern] of Object.entries(hostingPatterns)) {
            if (pattern.test(data.org.toLowerCase())) {
                return {
                    provider,
                    type: 'VPS/Cloud'
                };
            }
        }

        // Verificação de datacenter
        if (/datacenter|hosting|cloud/i.test(data.org)) {
            return {
                provider: data.org,
                type: 'Datacenter'
            };
        }

        return {
            provider: data.org,
            type: 'Dedicado/Outro'
        };
    } catch (error) {
        console.error('Erro ao verificar tipo de hosting:', error);
        return null;
    }
}

// Função para verificar suporte a protocolos de criptografia
async function checkCryptoProtocols(domain) {
    return new Promise((resolve) => {
        const options = {
            host: domain,
            port: 443,
            method: 'GET',
            rejectUnauthorized: false,
        };

        const req = https.request(options, (res) => {
            const protocols = {
                tls: res.socket.getProtocol(),
                ciphers: res.socket.getCipher(),
                cert: res.socket.getPeerCertificate()
            };

            // Análise de segurança
            const security = {
                hasModernTLS: ['TLSv1.2', 'TLSv1.3'].includes(protocols.tls),
                hasStrongCipher: protocols.ciphers?.name?.includes('AES'),
                hasPFS: protocols.ciphers?.name?.includes('ECDHE'),
                securityLevel: 'Desconhecido'
            };

            // Determina nível de segurança
            if (security.hasModernTLS && security.hasStrongCipher && security.hasPFS) {
                security.securityLevel = 'Alto';
            } else if (security.hasModernTLS && (security.hasStrongCipher || security.hasPFS)) {
                security.securityLevel = 'Médio';
            } else {
                security.securityLevel = 'Baixo';
            }

            resolve(security);
        });

        req.on('error', () => {
            resolve({
                hasModernTLS: false,
                hasStrongCipher: false,
                hasPFS: false,
                securityLevel: 'Indisponível'
            });
        });

        req.end();
    });
}

// Função para testar payloads
async function testPayloads(domain, proxyIP) {
    const payloads = {
        // Payloads Vivo
        'Vivo WSS': {
            method: 'GET',
            path: '/',
            headers: {
                'Host': domain,
                'Upgrade': 'websocket',
                'Connection': 'Upgrade',
                'Sec-WebSocket-Key': 'SGVsbG8sIHdvcmxkIQ=='
            }
        },
        'Vivo Direct': {
            method: 'GET',
            path: '/',
            headers: {
                'Host': domain,
                'Connection': 'Upgrade',
                'Upgrade': 'Websocket',
                'X-Real-IP': '127.0.0.1',
                'User-Agent': 'Upgrade'
            }
        },
        'Vivo Proxy': {
            method: 'GET',
            path: `http://${domain}/`,
            headers: {
                'Host': domain,
                'X-Online-Host': domain,
                'X-Forward-Host': domain,
                'Connection': 'Keep-Alive'
            }
        },
        'Vivo Continue': {
            method: 'POST',
            path: '/',
            headers: {
                'Host': domain,
                'Expect': '100-continue',
                'Content-Length': '1024',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Connection': 'Keep-Alive',
                'X-Online-Host': domain,
                'X-Forward-Host': domain,
                'X-Forwarded-For': '127.0.0.1',
                'User-Agent': 'Googlebot/2.1',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate',
                'Cache-Control': 'no-cache'
            }
        },

        // Payloads TIM
        'TIM Direct': {
            method: 'CONNECT',
            path: '/',
            headers: {
                'Host': domain,
                'X-Online-Host': domain,
                'Connection': 'Keep-Alive'
            }
        },
        'TIM Proxy': {
            method: 'GET',
            path: '/',
            headers: {
                'Host': domain,
                'X-Real-IP': '127.0.0.1',
                'Connection': 'Keep-Alive',
                'Proxy-Connection': 'Keep-Alive'
            }
        },
        'TIM Upgrade': {
            method: 'GET',
            path: '/',
            headers: {
                'Host': domain,
                'Upgrade': 'websocket',
                'Connection': 'Upgrade',
                'Sec-WebSocket-Protocol': 'TIM'
            }
        },
        'TIM Continue': {
            method: 'POST',
            path: '/',
            headers: {
                'Host': domain,
                'Expect': '100-continue',
                'Content-Length': '1024',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Connection': 'Keep-Alive',
                'X-Online-Host': domain,
                'Proxy-Connection': 'Keep-Alive',
                'X-Forward-Host': domain,
                'X-Forwarded-For': '127.0.0.1',
                'User-Agent': 'Googlebot/2.1',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate',
                'Cache-Control': 'no-cache',
                'X-T-Forward-For': '127.0.0.1',
                'X-Real-Host': domain
            }
        },

        // Payload Split ACL
        'Split ACL': {
            method: 'ACL',
            path: '/',
            headers: {
                'Host': domain,
                'Expect': '100-continue',
                'Connection': 'Upgrade',
                'Proxy-Connection': 'Keep-Alive',
                'Upgrade': 'websocket',
                'X-Forward-Protocol': 'https',
                'X-Forwarded-For': '127.0.0.1',
                'User-Agent': 'Googlebot/2.1'
            }
        },
        'Split Direct': {
            method: 'CONNECT',
            path: `/${domain}:443`,
            headers: {
                'Host': domain,
                'Connection': 'Keep-Alive',
                'Proxy-Connection': 'Keep-Alive',
                'X-Online-Host': domain
            }
        },

        // Payloads Gerais
        'CONNECT Direct': {
            method: 'CONNECT',
            path: `${domain}:443`,
            headers: {
                'Host': domain,
                'X-Online-Host': domain,
                'Connection': 'Keep-Alive',
                'Proxy-Connection': 'Keep-Alive'
            }
        },
        'SSL + Upgrade': {
            method: 'GET',
            path: '/',
            headers: {
                'Host': domain,
                'Upgrade': 'websocket',
                'Connection': 'Upgrade,Keep-Alive',
                'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Protocol': 'chat'
            }
        },
        'Real Host': {
            method: 'GET',
            path: '/',
            headers: {
                'Host': domain,
                'X-Real-IP': '127.0.0.1',
                'X-Forwarded-For': '127.0.0.1',
                'Connection': 'Keep-Alive',
                'Proxy-Connection': 'Keep-Alive'
            }
        },
        'Continue Test': {
            method: 'POST',
            path: '/',
            headers: {
                'Host': domain,
                'Expect': '100-continue',
                'Content-Length': '1024',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Connection': 'Keep-Alive'
            }
        }
    };

    // Adiciona opções específicas para o proxy quando necessário
    const proxyOptions = {
        host: domain,         // Usa o domínio fornecido como host
        port: 80,            // Porta padrão HTTP
        proxyHost: proxyIP,  // Usa o IP fornecido como proxy
        proxyPort: 80,       // Porta do proxy
        dns: ['8.8.8.8', '8.8.4.4'] // Servidores DNS
    };

    const results = {};
    
    for (const [name, payload] of Object.entries(payloads)) {
        try {
            const options = {
                host: name.includes('Split') ? proxyOptions.proxyHost : domain,
                port: name.includes('Split') ? proxyOptions.proxyPort : 443,
                method: payload.method,
                path: name.includes('Split') ? `http://${domain}${payload.path}` : payload.path,
                headers: {
                    ...payload.headers,
                    'Host': domain
                },
                rejectUnauthorized: false,
                timeout: 5000,
                lookup: name.includes('Split') ? (hostname, options, callback) => {
                    // Usa os DNS especificados para resolução
                    dns.resolve4(hostname, { servers: proxyOptions.dns }, (err, addresses) => {
                        callback(null, addresses ? addresses[0] : null, 4);
                    });
                } : undefined
            };

            const result = await new Promise((resolve) => {
                const req = https.request(options);
                
                req.on('response', (res) => {
                    resolve({
                        status: res.statusCode,
                        success: res.statusCode === 101 || res.statusCode === 200 || res.statusCode === 100,
                        headers: res.headers
                    });
                });

                req.on('continue', () => {
                    resolve({
                        status: 100,
                        success: true,
                        headers: { 
                            'status': '100 Continue',
                            'connection': 'keep-alive',
                            'content-length': '1024'
                        }
                    });
                    req.end();  // Encerra a requisição após receber 100-continue
                });

                req.on('upgrade', (res, socket, upgradeHead) => {
                    socket.destroy();
                    resolve({
                        status: 101,
                        success: true,
                        headers: res.headers
                    });
                });

                req.on('error', (error) => {
                    resolve({
                        status: 0,
                        success: false,
                        error: error.message
                    });
                });

                req.end();

                setTimeout(() => {
                    req.destroy();
                    resolve({
                        status: 0,
                        success: false,
                        error: 'Timeout'
                    });
                }, 5000);
            });

            results[name] = result;
        } catch (error) {
            results[name] = {
                status: 0,
                success: false,
                error: error.message
            };
        }
    }

    return results;
}

// Função para obter emoji do resultado do payload
function getPayloadStatusEmoji(result) {
    if (result.success) return '✅';
    if (result.status >= 200 && result.status < 300) return '🟡';
    if (result.status >= 300 && result.status < 400) return '↪️';
    if (result.status >= 400 && result.status < 500) return '⚠️';
    if (result.status >= 500) return '❌';
    return '❓';
}

// Comando /check para domínios
bot.onText(/\/check(?:@\w+)?\s+(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const input = match[1].toLowerCase();
    let domain;

    // Verifica se foi fornecido IP junto com o domínio
    if (input.includes(' ')) {
        [domain] = input.split(' ');
    } else {
        domain = input;
    }

    if (!isValidDomain(domain)) {
        bot.sendMessage(chatId, '❌ Por favor, envie um domínio válido (exemplo: google.com)');
        return;
    }

    try {
        const statusMessage = await bot.sendMessage(chatId, `🔍 Analisando o domínio ${domain}...`);
        const ips = await resolveDomain(domain);
        const httpStatus = await checkHttpStatus(domain);
        const sslInfo = await checkSSL(domain);
        const hasSSLPort = await checkPort(domain, 443);
        const hasHttpPort = await checkPort(domain, 80);
        const cryptoInfo = await checkCryptoProtocols(domain);

        if (!ips || ips.length === 0) {
            await bot.editMessageText(`❌ Não foi possível resolver o domínio ${domain}`, {
                chat_id: chatId,
                message_id: statusMessage.message_id
            });
            return;
        }

        let response = `🌐 Análise do domínio: ${domain}\n\n`;

        // Adiciona informação de status HTTP
        if (httpStatus) {
            const statusEmoji = getStatusEmoji(httpStatus.status);
            response += `📡 Conexão: ${httpStatus.protocol}\n`;
            response += `${statusEmoji} Status: ${httpStatus.status} (${getStatusDescription(httpStatus.status)})\n\n`;
        } else {
            response += `📡 Conexão: ❌ Não foi possível estabelecer conexão\n\n`;
        }

        // Informações de portas
        response += `🔌 Portas:\n`;
        response += `• HTTP (80): ${hasHttpPort ? '✅ Aberta' : '❌ Fechada'}\n`;
        response += `• SSL (443): ${hasSSLPort ? '✅ Aberta' : '❌ Fechada'}\n\n`;

        // Informações de SSL
        if (sslInfo) {
            response += `📜 Certificado SSL:\n`;
            response += `• Emissor: ${sslInfo.issuer}\n`;
            response += `• Válido de: ${sslInfo.validFrom}\n`;
            response += `• Válido até: ${sslInfo.validTo}\n\n`;
        }

        // Testa payloads para cada IP encontrado
        for (const ip of ips) {
            response += `\n📍 Testando IP: ${ip}\n`;
            const cdn = await analyzeIP(ip);
            if (cdn) {
                response += `CDN: ${cdn}\n`;
            }
            
            const payloadResults = await testPayloads(domain, ip);
            
            // Resultados Vivo
            response += `\n📱 VIVO:\n`;
            for (const [name, result] of Object.entries(payloadResults)) {
                if (name.startsWith('Vivo')) {
                    const emoji = getPayloadStatusEmoji(result);
                    const status = result.status || 'Erro';
                    const statusText = result.status === 101 ? 'Switching Protocols' :
                                     result.status === 200 ? 'OK' :
                                     result.error ? result.error : getStatusDescription(result.status);
                    
                    response += `• ${name}: ${emoji} ${status} ${statusText}\n`;
                }
            }

            // Resultados TIM
            response += `\n📱 TIM:\n`;
            for (const [name, result] of Object.entries(payloadResults)) {
                if (name.startsWith('TIM')) {
                    const emoji = getPayloadStatusEmoji(result);
                    const status = result.status || 'Erro';
                    const statusText = result.status === 101 ? 'Switching Protocols' :
                                     result.status === 200 ? 'OK' :
                                     result.error ? result.error : getStatusDescription(result.status);
                    
                    response += `• ${name}: ${emoji} ${status} ${statusText}\n`;
                }
            }

            // Resultados Gerais
            response += `\n🌐 Payloads Gerais:\n`;
            for (const [name, result] of Object.entries(payloadResults)) {
                if (!name.startsWith('Vivo') && !name.startsWith('TIM')) {
                    const emoji = getPayloadStatusEmoji(result);
                    const status = result.status || 'Erro';
                    const statusText = result.status === 101 ? 'Switching Protocols' :
                                     result.status === 200 ? 'OK' :
                                     result.error ? result.error : getStatusDescription(result.status);
                    
                    response += `• ${name}: ${emoji} ${status} ${statusText}\n`;
                }
            }
            
            // Adiciona informações de localização e hosting
            const location = await getIPLocation(ip);
            const hosting = await checkHostingType(ip);
            
            if (location && location.status === 'success') {
                response += `\n📌 ${location.city}, ${location.country}`;
                response += `\n🏢 ${location.isp}`;
                response += `\n🌍 ${location.regionName}`;
            }
            
            if (hosting) {
                response += `\n💻 Tipo: ${hosting.type}`;
                response += `\n🏭 Provedor: ${hosting.provider}`;
            }
            
            response += '\n\n-------------------\n';
        }

        await bot.editMessageText(response, {
            chat_id: chatId,
            message_id: statusMessage.message_id
        });
    } catch (error) {
        console.error('Erro:', error);
        bot.sendMessage(chatId, '❌ Desculpe, ocorreu um erro ao analisar o domínio.');
    }
});

// Função para obter emoji de nível de segurança
function getSecurityEmoji(level) {
    switch (level) {
        case 'Alto':
            return '🛡️';
        case 'Médio':
            return '⚜️';
        case 'Baixo':
            return '⚠️';
        default:
            return '❓';
    }
}

// Tratamento de erros
bot.on('polling_error', (error) => {
    console.error('Erro de polling:', error);
});

console.log('Bot iniciado!'); 
