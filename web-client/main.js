// 全局变量定义区域
let socket; // Socket.IO连接对象
let speedJoystick; // 速度摇杆控制器
let directionJoystick; // 方向摇杆控制器
let selectedDevice = ''; // 当前选择的设备ID
let lastSpeedValue = 0; // 上一次发送的速度值
let lastDirectionValue = 0; // 上一次发送的方向值
let networkDelay = 0; // 网络延迟时间(毫秒)
let isConnected = false; // 是否已连接到设备
let lastPingTime = 0; // 上一次发送ping的时间戳
let deviceAddresses = {}; // 存储设备ID和IP的映射关系
let connectedDeviceHistory = {}; // 存储连接过的设备历史记录

// 防抖函数，控制数据发送频率，避免频繁发送相似的控制命令
function debounce(func, wait) {
  let timeout; // 延时器
  return function(...args) {
    clearTimeout(timeout); // 清除先前的延时器
    timeout = setTimeout(() => func.apply(this, args), wait); // 设置新的延时器
  };
}

// 初始化Socket.io连接
function initSocket() {
  // 使用当前页面域名和端口创建WebSocket连接
  const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://'; // 根据页面协议选择WS或WSS
  const wsUrl = `${protocol}${window.location.host}`; // 构建WebSocket URL
  
  socket = io(wsUrl); // 创建Socket.IO连接
  
  // 连接成功事件处理
  socket.on('connect', () => {
    console.log('已连接到服务器'); // 调试信息
    document.getElementById('connection-status').textContent = '连接状态: 已连接到服务器'; // 更新UI状态
    
    // 发送客户端认证信息
    socket.emit('auth', {
      type: 'client' // 标识为客户端类型
    });
    
    // 启动心跳检测
    startHeartbeat();
  });
  
  // 断开连接事件处理
  socket.on('disconnect', () => {
    console.log('与服务器断开连接'); // 调试信息
    document.getElementById('connection-status').textContent = '连接状态: 已断开'; // 更新UI状态
    isConnected = false; // 更新连接状态
  });
  
  // 接收可用设备列表
  socket.on('available_devices', (devices) => {
    updateDeviceList(devices); // 更新设备列表UI
  });
  
  // 接收设备状态更新
  socket.on('device_status', (status) => {
    if (status.deviceId === selectedDevice) { // 确认是当前选择的设备
      updateDeviceStatus(status); // 更新设备状态UI
      
      // 如果状态包含IP地址信息，更新显示并保存
      if (status.ip) {
        deviceAddresses[status.deviceId] = status.ip; // 保存设备IP
        document.getElementById('device-ip').textContent = `设备IP: ${status.ip}`; // 更新UI显示
        // 保存到本地存储
        saveDeviceHistory();
      }
    }
  });
  
  // 设备断开连接事件处理
  socket.on('device_disconnected', (data) => {
    if (data.deviceId === selectedDevice) { // 确认是当前选择的设备
      document.getElementById('connection-status').textContent = '连接状态: 设备已断开'; // 更新UI状态
      isConnected = false; // 更新连接状态
    }
    
    // 从设备列表中移除断开的设备
    const deviceSelect = document.getElementById('device-select');
    for (let i = 0; i < deviceSelect.options.length; i++) {
      if (deviceSelect.options[i].value === data.deviceId) {
        deviceSelect.remove(i); // 删除对应选项
        break;
      }
    }
  });
  
  // 心跳响应处理
  socket.on('pong', (data) => {
    const currentTime = Date.now(); // 获取当前时间戳
    networkDelay = currentTime - data.received.timestamp; // 计算网络延迟
    document.getElementById('network-delay').textContent = `网络延迟: ${networkDelay}ms`; // 更新UI显示
  });
  
  // 接收设备IP地址信息
  socket.on('device_ip', (data) => {
    if (data.deviceId && data.ip) { // 验证数据有效性
      deviceAddresses[data.deviceId] = data.ip; // 保存设备IP
      if (data.deviceId === selectedDevice) { // 如果是当前设备则更新显示
        document.getElementById('device-ip').textContent = `设备IP: ${data.ip}`;
      }
      // 保存到本地存储
      saveDeviceHistory();
    }
  });
}

// 初始化摇杆控制器
function initJoysticks() {
  // 初始化方向摇杆(左侧) - 控制前轮转向
  directionJoystick = nipplejs.create({
    zone: document.getElementById('direction-joystick'), // 容器元素
    mode: 'static', // 静态模式(固定位置)
    position: { left: '50%', top: '50%' }, // 摇杆中心位置
    color: '#3498db', // 蓝色表示转向
    size: 150, // 摇杆大小
    dynamicPage: true, // 动态页面配置
    fadeTime: 0, // 淡出时间
    catchDistance: 150, // 捕捉距离
    restOpacity: 0.8 // 静止状态透明度
  });
  
  // 初始化速度摇杆(右侧) - 控制后轮驱动
  speedJoystick = nipplejs.create({
    zone: document.getElementById('speed-joystick'), // 容器元素
    mode: 'static', // 静态模式(固定位置)
    position: { left: '50%', top: '50%' }, // 摇杆中心位置
    color: '#e74c3c', // 红色表示驱动
    size: 150, // 摇杆大小
    dynamicPage: true, // 动态页面配置
    fadeTime: 0, // 淡出时间
    catchDistance: 150, // 捕捉距离
    restOpacity: 0.8 // 静止状态透明度
  });
  
  // 创建防抖函数，每50ms最多发送一次控制数据
  const sendControlData = debounce((speed, direction) => {
    if (!isConnected || !selectedDevice) return; // 未连接时不发送
    
    console.log(`发送控制命令 - 驱动(后轮): ${speed}%, 转向(前轮): ${direction}°`); // 调试信息
    
    // 发送控制指令到服务器
    socket.emit('control', {
      targetDevice: selectedDevice, // 目标设备ID
      command: {
        speed, // 速度值
        direction // 方向值
      }
    });
  }, 50);
  
  // 左侧摇杆事件监听 - 控制前轮转向
  directionJoystick.on('move', (evt, data) => {
    // 使用Y轴数据，上下移动控制转向角度 (-90~90)
    const y = data.vector.y; // 获取Y轴向量值(-1到1)
    const directionValue = Math.round(y * 90); // 转换为角度值
    document.getElementById('direction-value').textContent = `${directionValue}°`; // 更新UI显示
    
    // 检查变化是否超过5%，避免发送过于频繁
    if (Math.abs(directionValue - lastDirectionValue) > 4.5) { // 5% of 90
      lastDirectionValue = directionValue; // 更新最后发送值
      sendControlData(lastSpeedValue, directionValue); // 发送控制数据
    }
  });
  
  // 左侧摇杆释放事件 - 转向回正
  directionJoystick.on('end', () => {
    document.getElementById('direction-value').textContent = '0°'; // 更新UI显示为零
    lastDirectionValue = 0; // 重置最后发送值
    sendControlData(lastSpeedValue, 0); // 发送回正命令
  });
  
  // 右侧摇杆事件监听 - 控制后轮驱动
  speedJoystick.on('move', (evt, data) => {
    // 使用X轴数据，左右移动控制驱动速度 (-100~100)
    const x = data.vector.x; // 获取X轴向量值(-1到1)
    const speedValue = Math.round(x * 100); // 转换为百分比值
    document.getElementById('speed-value').textContent = `${speedValue}%`; // 更新UI显示
    
    // 检查变化是否超过5%，避免发送过于频繁
    if (Math.abs(speedValue - lastSpeedValue) > 5) {
      lastSpeedValue = speedValue; // 更新最后发送值
      sendControlData(speedValue, lastDirectionValue); // 发送控制数据
    }
  });
  
  // 右侧摇杆释放事件 - 停止驱动
  speedJoystick.on('end', () => {
    document.getElementById('speed-value').textContent = '0%'; // 更新UI显示为零
    lastSpeedValue = 0; // 重置最后发送值
    sendControlData(0, lastDirectionValue); // 发送停止命令
  });
}

// 更新设备列表UI
function updateDeviceList(devices) {
  const deviceSelect = document.getElementById('device-select'); // 获取下拉列表元素
  
  // 清空现有选项，保留"请选择一个设备"选项
  while (deviceSelect.options.length > 1) {
    deviceSelect.remove(1);
  }
  
  // 加载保存的设备历史
  loadDeviceHistory();
  
  // 添加新设备到下拉列表，并显示IP（如果已知）
  devices.forEach(deviceId => {
    const option = document.createElement('option'); // 创建新选项
    option.value = deviceId; // 设置选项值
    
    // 如果有IP信息，在选项中显示
    if (deviceAddresses[deviceId]) {
      option.textContent = `${deviceId} (${deviceAddresses[deviceId]})`; // 设备ID及IP
    } else {
      option.textContent = deviceId; // 仅设备ID
    }
    
    deviceSelect.appendChild(option); // 添加到下拉列表
  });
}

// 保存设备历史到本地存储
function saveDeviceHistory() {
  // 将最近连接的设备及其IP保存到历史记录
  connectedDeviceHistory = {
    ...connectedDeviceHistory, // 保留原有历史
    ...deviceAddresses // 添加新的设备IP信息
  };
  
  try {
    localStorage.setItem('deviceHistory', JSON.stringify(connectedDeviceHistory)); // 保存到localStorage
  } catch (e) {
    console.log('无法保存设备历史到本地存储'); // 错误处理
  }
}

// 从本地存储加载设备历史
function loadDeviceHistory() {
  try {
    const savedHistory = localStorage.getItem('deviceHistory'); // 从localStorage读取
    if (savedHistory) {
      connectedDeviceHistory = JSON.parse(savedHistory); // 解析JSON数据
      // 更新当前的设备地址映射
      deviceAddresses = {...connectedDeviceHistory}; // 复制历史数据到当前映射
    }
  } catch (e) {
    console.log('无法从本地存储加载设备历史'); // 错误处理
  }
}

// 更新设备状态显示UI
function updateDeviceStatus(status) {
  if (status.voltage) {
    document.getElementById('battery-level').textContent = `电池电压: ${status.voltage.toFixed(1)}V`; // 显示电池电压，保留1位小数
  }
  
  if (status.signalStrength) {
    document.getElementById('signal-strength').textContent = `信号强度: ${status.signalStrength}%`; // 显示信号强度
  }
}

// 启动心跳检测
function startHeartbeat() {
  setInterval(() => {
    if (socket.connected) { // 只在连接状态下发送
      lastPingTime = Date.now(); // 记录发送时间
      socket.emit('ping', {
        timestamp: lastPingTime // 发送当前时间戳
      });
    }
  }, 3000); // 每3秒发送一次
}

// 连接按钮点击事件处理
document.getElementById('connect-btn').addEventListener('click', () => {
  const deviceSelect = document.getElementById('device-select'); // 获取设备选择下拉框
  selectedDevice = deviceSelect.value; // 获取选中的设备ID
  
  if (!selectedDevice) {
    alert('请选择一个设备'); // 未选择设备时提示
    return;
  }
  
  document.getElementById('connection-status').textContent = `连接状态: 已连接到 ${selectedDevice}`; // 更新连接状态UI
  
  // 如果有IP地址，显示它
  if (deviceAddresses[selectedDevice]) {
    document.getElementById('device-ip').textContent = `设备IP: ${deviceAddresses[selectedDevice]}`; // 显示已知IP
  } else {
    document.getElementById('device-ip').textContent = `设备IP: --`; // 显示未知状态
    
    // 请求设备IP地址
    socket.emit('get_device_ip', {
      deviceId: selectedDevice // 发送设备ID请求IP信息
    });
  }
  
  isConnected = true; // 更新连接状态
});

// 检测屏幕方向变化
function checkOrientation() {
  // 如果是横屏模式(宽度大于高度)，添加横屏类
  if (window.innerWidth > window.innerHeight) {
    document.querySelector('.container').classList.add('landscape-mode');
  } else {
    document.querySelector('.container').classList.remove('landscape-mode');
  }
}

// 页面加载完成后初始化
window.addEventListener('DOMContentLoaded', () => {
  // 加载设备历史
  loadDeviceHistory();
  
  initSocket(); // 初始化Socket连接
  initJoysticks(); // 初始化摇杆控制
  
  // 监听屏幕方向变化事件
  window.addEventListener('resize', checkOrientation);
  window.addEventListener('orientationchange', checkOrientation);
  
  // 初始检测屏幕方向
  checkOrientation();
}); 