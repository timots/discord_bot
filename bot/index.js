// bot/index.js
require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message]
});

// Cache untuk menyimpan stats
let statsCache = {
  studentCount: 0,
  teacherCount: 0,
  dailyMessages: 0,
  lastUpdate: null
};

// Fungsi untuk menghitung member berdasarkan role
async function updateStats(guild) {
  try {
    console.log('🔄 Updating stats...');
    
    // Fetch all members
    const members = await guild.members.fetch();
    console.log(`📊 Total members: ${members.size}`);
    
    // Hitung student (role: student)
    const studentRole = guild.roles.cache.find(role => 
      role.name.toLowerCase() === 'student'
    );
    const studentCount = studentRole 
      ? members.filter(member => member.roles.cache.has(studentRole.id)).size 
      : 0;
    console.log(`👨‍🎓 Students: ${studentCount}`);

    // Hitung teacher (role: teacher)
    const teacherRole = guild.roles.cache.find(role => 
      role.name.toLowerCase() === 'teacher'
    );
    const teacherCount = teacherRole 
      ? members.filter(member => member.roles.cache.has(teacherRole.id)).size 
      : 0;
    console.log(`👨‍🏫 Teachers: ${teacherCount}`);

    // Hitung pesan 24 jam terakhir
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let totalMessages = 0;

    // Ambil semua text channels
    const channels = guild.channels.cache.filter(
      channel => channel.isTextBased() && channel.viewable
    );

    console.log(`📝 Scanning ${channels.size} channels for messages...`);

    for (const [, channel] of channels) {
      try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const recentMessages = messages.filter(
          msg => msg.createdTimestamp > oneDayAgo
        );
        totalMessages += recentMessages.size;

        // Jika ada 100 pesan dalam 24 jam, fetch lebih banyak
        if (recentMessages.size === 100) {
          let lastMessageId = messages.last().id;
          let hasMore = true;

          while (hasMore && totalMessages < 10000) {
            const olderMessages = await channel.messages.fetch({
              limit: 100,
              before: lastMessageId
            });

            if (olderMessages.size === 0) {
              hasMore = false;
              break;
            }

            const recentOlderMessages = olderMessages.filter(
              msg => msg.createdTimestamp > oneDayAgo
            );

            if (recentOlderMessages.size === 0) {
              hasMore = false;
              break;
            }

            totalMessages += recentOlderMessages.size;
            lastMessageId = olderMessages.last().id;
          }
        }
      } catch (error) {
        console.error(`⚠️ Error fetching messages from ${channel.name}:`, error.message);
      }
    }

    console.log(`💬 Total messages in 24h: ${totalMessages}`);

    // Update cache
    statsCache = {
      studentCount,
      teacherCount,
      dailyMessages: totalMessages,
      lastUpdate: new Date().toISOString()
    };

    console.log('✅ Stats updated successfully!');
    return statsCache;
  } catch (error) {
    console.error('❌ Error updating stats:', error);
    throw error;
  }
}

// Event ketika bot ready
client.once('ready', async () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
  
  const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
  if (guild) {
    console.log(`📊 Connected to server: ${guild.name}`);
    
    // Update stats pertama kali
    await updateStats(guild);
    
    // Update stats setiap 5 menit
    setInterval(async () => {
      await updateStats(guild);
    }, 5 * 60 * 1000);
  } else {
    console.error('❌ Guild not found! Check your DISCORD_GUILD_ID in .env file');
  }
});

// Endpoint API untuk Next.js
app.get('/api/discord-stats', async (req, res) => {
  try {
    const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
    
    if (!guild) {
      return res.status(404).json({ error: 'Guild not found' });
    }

    // Jika cache sudah lama (lebih dari 10 menit), update
    const cacheAge = statsCache.lastUpdate 
      ? Date.now() - new Date(statsCache.lastUpdate).getTime() 
      : Infinity;
    
    if (cacheAge > 10 * 60 * 1000) {
      console.log('⏰ Cache expired, updating stats...');
      await updateStats(guild);
    }

    res.json({
      success: true,
      data: statsCache
    });
  } catch (error) {
    console.error('❌ Error in API endpoint:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch stats' 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    botStatus: client.user ? 'online' : 'offline',
    lastUpdate: statsCache.lastUpdate
  });
});

// Start Express server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
  console.log(`📍 Stats API: http://localhost:${PORT}/api/discord-stats`);
});

// Login bot
client.login(process.env.DISCORD_BOT_TOKEN);

// Handle errors
client.on('error', error => {
  console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});