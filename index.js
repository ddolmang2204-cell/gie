require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const {
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    NoSubscriberBehavior
} = require('@discordjs/voice');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const express = require('express');

process.on('unhandledRejection', (err) => {
    console.error('[UNHANDLED REJECTION]', err);
});
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]', err);
});

if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
    if (process.platform !== 'win32') {
        execFile('chmod', ['+x', ffmpegPath], (err) => {
            if (err) console.error('[FFMPEG CHMOD ERR]', err);
        });
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('소리 Bot is alive!');
});

app.listen(PORT, () => {
    console.log(`[SYS] Web server is running and listening on port ${PORT}`);
});

const ADMIN_ID = process.env.ADMIN_ID || '1429412320194592811';
const TOKENS = Array.from({ length: 17 }, (_, i) => process.env[`TOKEN_${i + 1}`]).filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function startBot(token, index) {
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates
        ]
    });

    const players = new Map();

    client.once('ready', () => {
        console.log(`✅ [봇 ${index + 1}] ${client.user.tag} 온라인`);
    });

    client.on('messageCreate', async (message) => {
        if (message.author.bot || !message.content.startsWith('!')) return;
        if (message.author.id !== ADMIN_ID) return;

        const args = message.content.slice(1).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        // !h - 17개 봇 모두 명령어 목록 출력
        if (command === 'h') {
            await sleep(index * 300);
            const helpMessage =
                "```\n" +
                "!vc [음성채널ID] | 음성채널 접속\n" +
                "!vcs | 음성채널 퇴장\n" +
                "!재생 [~.mp3] | mp3 파일 루프로 재생\n" +
                "!재생중지 | mp3 파일 재생 중지\n" +
                "!h | 명령어 목록\n" +
                "```";
            return message.reply(helpMessage).catch(() => {});
        }

        // !vc [음성채널ID] - 0.3초 간격 순차 접속 + 17개 봇 모두 안내
        if (command === 'vc') {
            const channelId = args[0];
            if (!channelId) {
                await sleep(index * 300);
                message.reply('접속할 음성채널 ID를 입력해주세요. 예: `!vc 123456789012345678`').catch(() => {});
                return;
            }

            const voiceChannel = message.guild.channels.cache.get(channelId);
            if (!voiceChannel || voiceChannel.type !== 2) {
                await sleep(index * 300);
                message.reply('올바른 음성채널 ID를 입력해주세요.').catch(() => {});
                return;
            }

            await sleep(index * 300);

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                    group: `bot_${index}`
                });

                connection.on(VoiceConnectionStatus.Ready, () => {
                    console.log(`🔊 [봇 ${index + 1}] 음성 연결 Ready (${voiceChannel.name})`);
                });

                connection.on('error', (err) => {
                    console.error(`❌ [봇 ${index + 1}] 음성 연결 오류:`, err);
                });

                message.reply(`🔊 **${voiceChannel.name}** 채널에 접속했습니다.`).catch(() => {});
            } catch (error) {
                console.error(`[봇 ${index + 1}] 접속 오류:`, error);
            }
        }

        // !vcs - 음성채널 퇴장 + 17개 봇 모두 안내
        if (command === 'vcs') {
            const connection = getVoiceConnection(message.guild.id, `bot_${index}`);
            if (!connection) return;

            if (players.has(message.guild.id)) {
                const serverAudio = players.get(message.guild.id);
                serverAudio.isLooping = false;
                serverAudio.player.stop();
                players.delete(message.guild.id);
            }

            await sleep(index * 300);
            connection.destroy();
            message.reply('👋 음성채널에서 퇴장했습니다.').catch(() => {});
        }

        // !재생 [~.mp3] - 모든 봇 동일 파일 무한 루프 + 17개 봇 모두 안내
        if (command === '재생') {
            const connection = getVoiceConnection(message.guild.id, `bot_${index}`);
            if (!connection) {
                await sleep(index * 300);
                message.reply('먼저 `!vc [음성채널ID]` 명령어로 봇을 음성채널에 접속시켜주세요.').catch(() => {});
                return;
            }

            const fileName = args[0];
            if (!fileName) {
                await sleep(index * 300);
                message.reply('재생할 파일명을 입력해주세요. 예: `!재생 4.mp3`').catch(() => {});
                return;
            }

            const filePath = path.join(__dirname, fileName);
            if (!fs.existsSync(filePath)) {
                await sleep(index * 300);
                message.reply(`\`${fileName}\` 파일을 찾을 수 없습니다.`).catch(() => {});
                return;
            }

            await sleep(index * 300);

            let serverAudio = players.get(message.guild.id);
            if (!serverAudio) {
                const player = createAudioPlayer({
                    behaviors: {
                        noSubscriber: NoSubscriberBehavior.Play
                    }
                });

                serverAudio = {
                    player,
                    isLooping: true,
                    currentFile: filePath
                };

                player.on(AudioPlayerStatus.Playing, () => {
                    console.log(`▶️ [봇 ${index + 1}] 재생 중: ${path.basename(serverAudio.currentFile)}`);
                });

                player.on(AudioPlayerStatus.Idle, () => {
                    if (serverAudio.isLooping) {
                        const resource = createAudioResource(serverAudio.currentFile, {
                            inlineVolume: true
                        });
                        player.play(resource);
                    }
                });

                player.on('error', (error) => {
                    console.error(`❌ [봇 ${index + 1}] 플레이어 오류:`, error);
                });

                connection.subscribe(player);
                players.set(message.guild.id, serverAudio);
            } else {
                connection.subscribe(serverAudio.player);
            }

            serverAudio.isLooping = true;
            serverAudio.currentFile = filePath;
            const resource = createAudioResource(filePath, {
                inlineVolume: true
            });
            serverAudio.player.play(resource);

            message.reply(`🔁 **${fileName}** 파일을 반복 재생합니다.`).catch(() => {});
        }

        // !재생중지 - 재생 중지 + 17개 봇 모두 안내
        if (command === '재생중지') {
            const serverAudio = players.get(message.guild.id);
            if (!serverAudio) return;

            serverAudio.isLooping = false;
            serverAudio.player.stop();

            await sleep(index * 300);
            message.reply('⏹️ 재생을 중지했습니다.').catch(() => {});
        }
    });

    client.login(token).catch((err) => {
        console.error(`❌ [봇 ${index + 1}] 로그인 실패:`, err.message);
    });
}

TOKENS.forEach((token, idx) => startBot(token, idx));