const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

// 配置
const PORT = process.env.PORT || 3000;
const DEVICE_AUTH = {
  // 设备ID和密钥，实际应用中应存储在数据库或环境变量中
  'ESP8266_001': 'secret_key_001',
  'ESP8266_002': 'secret_key_002',
};

// 初始化Express应用
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  // 添加以下配置，使Socket.io支持多种传输方式
  transports: ['websocket', 'polling'],
  allowEIO3: true // 允许兼容Socket.IO v3客户端
});

// 存储设备和客户端连接
const connectedDevices = {};
const connectedClients = {};

// 静态文件服务
app.use(express.static(path.join(__dirname, '../web-client')));

// 根路由返回控制界面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../web-client/index.html'));
});

// Socket.io连接处理
io.on('connection', (socket) => {
  console.log('新连接: ', socket.id);

  // 设备认证处理
  socket.on('auth', (data) => {
    const { deviceId, deviceKey, type } = data;
    
    if (type === 'device') {
      // 验证设备身份
      if (DEVICE_AUTH[deviceId] === deviceKey) {
        console.log(`设备 ${deviceId} 认证成功`);
        connectedDevices[deviceId] = socket.id;
        socket.deviceId = deviceId;
        socket.emit('auth_response', { success: true });
      } else {
        console.log(`设备 ${deviceId} 认证失败`);
        socket.emit('auth_response', { success: false, message: '认证失败' });
      }
    } else if (type === 'client') {
      // 客户端连接无需认证（实际应用中可添加用户认证）
      const clientId = `client_${socket.id}`;
      connectedClients[clientId] = socket.id;
      socket.clientId = clientId;
      
      // 向客户端发送当前连接的设备列表
      socket.emit('available_devices', Object.keys(connectedDevices));
    }
  });

  // 控制指令转发: 客户端 -> 设备
  socket.on('control', (data) => {
    const { targetDevice, command } = data;
    
    if (connectedDevices[targetDevice]) {
      io.to(connectedDevices[targetDevice]).emit('command', {
        command,
        timestamp: Date.now()
      });
    }
  });

  // 状态反馈转发: 设备 -> 客户端
  socket.on('status', (data) => {
    // 广播给所有客户端
    Object.values(connectedClients).forEach(clientSocketId => {
      io.to(clientSocketId).emit('device_status', {
        deviceId: socket.deviceId,
        ...data,
        timestamp: Date.now()
      });
    });
  });

  // 心跳包处理
  socket.on('ping', (data) => {
    socket.emit('pong', { 
      timestamp: Date.now(),
      received: data
    });
  });

  // 断开连接处理
  socket.on('disconnect', () => {
    console.log('连接断开: ', socket.id);
    
    // 清理设备连接
    if (socket.deviceId) {
      delete connectedDevices[socket.deviceId];
      // 通知所有客户端设备离线
      Object.values(connectedClients).forEach(clientSocketId => {
        io.to(clientSocketId).emit('device_disconnected', {
          deviceId: socket.deviceId
        });
      });
    }
    
    // 清理客户端连接
    if (socket.clientId) {
      delete connectedClients[socket.clientId];
    }
  });
});

// 启动服务器并监听所有网络接口
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行在端口 ${PORT}`);
  console.log(`本地访问: http://localhost:${PORT}`);
  console.log(`网络访问: http://<您的IP地址>:${PORT}`);
}); 