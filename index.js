
require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    ChannelType
} = require('discord.js');

const {
    joinVoiceChannel,
    getVoiceConnection,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    entersState,
    NoSubscriberBehavior,
    StreamType
} = require('@discordjs/voice');

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const express = require('express');

// ==========================================
// 시스템 설정
// ==========================================

const ADMIN_ID = process.env.ADMIN_ID || '1429412320194592811';

const TOKENS = Array.from(
    { length: 17 },
    (_, i) => process.env[`TOKEN_${i + 1}`]
).filter(Boolean);

const PORT = process.env.PORT || 3000;

const sleep = ms =>
    new Promise(resolve => setTimeout(resolve, ms));

// ==========================================
// 오류 감지
// ==========================================

process.on('unhandledRejection', error => {
    console.error('[UNHANDLED REJECTION]', error);
});

process.on('uncaughtException', error => {
    console.error('[UNCAUGHT EXCEPTION]', error);
});

// ==========================================
// 웹 서버
// ==========================================

const app = express();

app.get('/', (req, res) => {
    res.send('소리 Bot is alive!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SYS] Web server started: ${PORT}`);
});

// ==========================================
// FFmpeg 확인
// ==========================================

if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
    console.error('[FFMPEG] FFmpeg 실행 파일을 찾을 수 없습니다');
}

// ==========================================
// 메시지 전송
// ==========================================

async function sendMessage(channel, content, index) {
    try {
        await channel.send(content);
    } catch (error) {
        console.error(
            `[봇 ${index + 1}] 메시지 전송 실패:`,
            error.message
        );
    }
}

// ==========================================
// 오디오 정지
// ==========================================

function stopAudio(serverAudio) {
    if (!serverAudio) return;

    serverAudio.isLooping = false;

    if (serverAudio.ffmpeg) {
        try {
            serverAudio.ffmpeg.kill('SIGKILL');
        } catch {}
    }

    serverAudio.player.stop(true);
}

// ==========================================
// FFmpeg 오디오 재생
// ==========================================

function startPlayback(serverAudio, index) {
    if (!serverAudio.isLooping) return;

    if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
        serverAudio.isLooping = false;

        sendMessage(
            serverAudio.channel,
            '❌ FFmpeg 실행 파일을 찾을 수 없습니다',
            index
        );

        return;
    }

    if (!fs.existsSync(serverAudio.currentFile)) {
        serverAudio.isLooping = false;

        sendMessage(
            serverAudio.channel,
            '❌ MP3 파일을 찾을 수 없습니다',
            index
        );

        return;
    }

    let ffmpeg;

    try {
        ffmpeg = spawn(ffmpegPath, [
            '-hide_banner',
            '-loglevel', 'error',
            '-re',
            '-i', serverAudio.currentFile,
            '-vn',
            '-ac', '2',
            '-ar', '48000',
            '-f', 's16le',
            'pipe:1'
        ]);

        serverAudio.ffmpeg = ffmpeg;

        let errorOutput = '';

        ffmpeg.stderr.on('data', data => {
            errorOutput += data.toString();

            if (errorOutput.length > 3000) {
                errorOutput = errorOutput.slice(-3000);
            }
        });

        ffmpeg.on('error', error => {
            console.error(
                `[봇 ${index + 1}] FFmpeg 실행 오류:`,
                error
            );

            serverAudio.isLooping = false;

            sendMessage(
                serverAudio.channel,
                `❌ FFmpeg 오류: ${error.message}`,
                index
            );
        });

        ffmpeg.stdout.on('error', error => {
            console.error(
                `[봇 ${index + 1}] 오디오 스트림 오류:`,
                error.message
            );
        });

        ffmpeg.on('close', code => {
            if (!serverAudio.isLooping) return;

            if (code !== 0) {
                console.error(
                    `[봇 ${index + 1}] FFmpeg 종료 코드:`,
                    code,
                    errorOutput
                );

                serverAudio.isLooping = false;

                sendMessage(
                    serverAudio.channel,
                    `❌ 오디오 변환 실패 (코드: ${code})\n${errorOutput.slice(0, 1000)}`,
                    index
                );
            }
        });

        const resource = createAudioResource(ffmpeg.stdout, {
            inputType: StreamType.Raw
        });

        serverAudio.player.play(resource);

    } catch (error) {
        console.error(
            `[봇 ${index + 1}] 재생 생성 실패:`,
            error
        );

        serverAudio.isLooping = false;

        sendMessage(
            serverAudio.channel,
            `❌ 재생 오류: ${error.message}`,
            index
        );
    }
}

// ==========================================
// 봇 시작
// ==========================================

function startBot(token, index) {

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
            GatewayIntentBits.GuildVoiceStates
        ]
    });

    // 봇별 독립적인 오디오 관리
    const players = new Map();

    client.once('ready', () => {
        console.log(
            `✅ [봇 ${index + 1}] ${client.user.tag} 온라인`
        );
    });

    // ======================================
    // 음성 플레이어 반복 재생 이벤트
    // ======================================

    function createServerAudio(filePath, channel, guildId) {

        const player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });

        const serverAudio = {
            player,
            isLooping: true,
            currentFile: filePath,
            channel,
            ffmpeg: null
        };

        player.on(AudioPlayerStatus.Playing, () => {
            console.log(
                `[봇 ${index + 1}] 재생 중: ${path.basename(filePath)}`
            );
        });

        player.on(AudioPlayerStatus.Idle, () => {

            if (!serverAudio.isLooping) return;

            console.log(
                `[봇 ${index + 1}] 반복 재생 시작`
            );

            sleep(300).then(() => {
                if (serverAudio.isLooping) {
                    startPlayback(serverAudio, index);
                }
            });
        });

        player.on('error', error => {
            console.error(
                `[봇 ${index + 1}] 플레이어 오류:`,
                error
            );

            sendMessage(
                channel,
                `❌ 플레이어 오류: ${error.message}`,
                index
            );
        });

        players.set(guildId, serverAudio);

        return serverAudio;
    }

    // ======================================
    // 명령어 처리
    // ======================================

    client.on('messageCreate', async message => {

        if (message.author.bot) return;
        if (!message.content.startsWith('!')) return;
        if (message.author.id !== ADMIN_ID) return;
        if (!message.guild) return;

        const args = message.content
            .slice(1)
            .trim()
            .split(/\s+/);

        const command = args.shift()?.toLowerCase();

        if (!command) return;

        // 봇별 순차 응답
        await sleep(index * 300);

        console.log(
            `[명령어] 봇 ${index + 1} | ${command}`
        );

        // ==================================
        // !h
        // ==================================

        if (command === 'h') {

            const helpMessage =
                '```\n' +
                '!vc [음성채널ID] | 음성채널 접속\n' +
                '!vcs | 음성채널 퇴장\n' +
                '!재생 [파일명.mp3] | MP3 반복 재생\n' +
                '!재생중지 | MP3 재생 중지\n' +
                '!h | 명령어 목록\n' +
                '```';

            await sendMessage(
                message.channel,
                helpMessage,
                index
            );

            return;
        }

        // ==================================
        // !vc
        // ==================================

        if (command === 'vc') {

            const channelId = args[0];

            if (!channelId) {
                await sendMessage(
                    message.channel,
                    '❌ 음성채널 ID를 입력해주세요',
                    index
                );

                return;
            }

            let voiceChannel;

            try {
                voiceChannel = await message.guild.channels.fetch(
                    channelId
                );
            } catch {
                voiceChannel = null;
            }

            if (
                !voiceChannel ||
                voiceChannel.type !== ChannelType.GuildVoice
            ) {
                await sendMessage(
                    message.channel,
                    '❌ 올바른 음성채널 ID가 아닙니다',
                    index
                );

                return;
            }

            try {

                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                    group: `bot_${index}`,
                    selfMute: false,
                    selfDeaf: false
                });

                connection.on('error', error => {
                    console.error(
                        `[봇 ${index + 1}] 음성 연결 오류:`,
                        error
                    );
                });

                connection.on(
                    VoiceConnectionStatus.Disconnected,
                    async () => {

                        try {
                            await Promise.race([
                                entersState(
                                    connection,
                                    VoiceConnectionStatus.Signalling,
                                    5000
                                ),
                                entersState(
                                    connection,
                                    VoiceConnectionStatus.Connecting,
                                    5000
                                )
                            ]);
                        } catch {
                            connection.destroy();
                        }
                    }
                );

                await entersState(
                    connection,
                    VoiceConnectionStatus.Ready,
                    20000
                );

                console.log(
                    `[봇 ${index + 1}] ${voiceChannel.name} Ready`
                );

                await sendMessage(
                    message.channel,
                    `🔊 **${voiceChannel.name}** 채널에 접속했습니다`,
                    index
                );

            } catch (error) {

                console.error(
                    `[봇 ${index + 1}] 접속 실패:`,
                    error
                );

                await sendMessage(
                    message.channel,
                    `❌ 음성 접속 실패: ${error.message}`,
                    index
                );
            }

            return;
        }

        // ==================================
        // !vcs
        // ==================================

        if (command === 'vcs') {

            const serverAudio = players.get(message.guild.id);

            if (serverAudio) {
                stopAudio(serverAudio);
                players.delete(message.guild.id);
            }

            const connection = getVoiceConnection(
                message.guild.id,
                `bot_${index}`
            );

            if (connection) {
                connection.destroy();

                await sendMessage(
                    message.channel,
                    '👋 음성채널에서 퇴장했습니다',
                    index
                );
            } else {
                await sendMessage(
                    message.channel,
                    '현재 음성채널에 접속해 있지 않습니다',
                    index
                );
            }

            return;
        }

        // ==================================
        // !재생
        // ==================================

        if (command === '재생') {

            const connection = getVoiceConnection(
                message.guild.id,
                `bot_${index}`
            );

            if (!connection) {

                await sendMessage(
                    message.channel,
                    '❌ 먼저 !vc 명령어로 음성채널에 접속해주세요',
                    index
                );

                return;
            }

            const fileName = args[0];

            if (!fileName) {

                await sendMessage(
                    message.channel,
                    '❌ 파일명을 입력해주세요. 예: !재생 4.mp3',
                    index
                );

                return;
            }

            const filePath = path.resolve(
                __dirname,
                path.basename(fileName)
            );

            if (!fs.existsSync(filePath)) {

                await sendMessage(
                    message.channel,
                    `❌ ${fileName} 파일을 찾을 수 없습니다`,
                    index
                );

                return;
            }

            try {

                await entersState(
                    connection,
                    VoiceConnectionStatus.Ready,
                    15000
                );

                const oldAudio = players.get(message.guild.id);

                if (oldAudio) {
                    stopAudio(oldAudio);
                    players.delete(message.guild.id);
                }

                const serverAudio = createServerAudio(
                    filePath,
                    message.channel,
                    message.guild.id
                );

                connection.subscribe(serverAudio.player);

                startPlayback(serverAudio, index);

                await sendMessage(
                    message.channel,
                    `🔁 **${fileName}** 반복 재생을 시작했습니다`,
                    index
                );

            } catch (error) {

                console.error(
                    `[봇 ${index + 1}] 재생 시작 실패:`,
                    error
                );

                await sendMessage(
                    message.channel,
                    `❌ 재생 시작 실패: ${error.message}`,
                    index
                );
            }

            return;
        }

        // ==================================
        // !재생중지
        // ==================================

        if (command === '재생중지') {

            const serverAudio = players.get(message.guild.id);

            if (!serverAudio) {

                await sendMessage(
                    message.channel,
                    '현재 재생 중인 음악이 없습니다',
                    index
                );

                return;
            }

            stopAudio(serverAudio);

            players.delete(message.guild.id);

            await sendMessage(
                message.channel,
                '⏹️ 재생을 중지했습니다',
                index
            );

            return;
        }

    });

    // ======================================
    // 로그인
    // ======================================

    client.login(token).catch(error => {

        console.error(
            `❌ [봇 ${index + 1}] 로그인 실패:`,
            error
        );

    });
}

// ==========================================
// 17개 봇 실행
// ==========================================

console.log(`[SYS] 등록된 봇 개수: ${TOKENS.length}`);

if (TOKENS.length === 0) {
    console.error('[SYS] TOKEN_1부터 TOKEN_17까지 확인해주세요');
}

TOKENS.forEach((token, index) => {
    startBot(token, index);
});
