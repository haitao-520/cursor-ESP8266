# cursor-ESP8266 双电机远程遥控车
这是一个利用cursor制作基于ESP8266开发版的远程遥控车，由我自己提供指令，cursor制作完成

# 物联网小车控制系统

基于WebSocket的物联网小车远程控制系统，包含服务器、手机客户端和ESP8266固件三个部分。

## 系统架构

1. **云服务器端(Node.js)**
   - 基于Express和Socket.io的WebSocket服务
   - 实现设备认证（设备ID+密钥校验）
   - 消息转发：手机 → 服务器 → ESP8266（控制指令）及 ESP8266 → 服务器 → 手机（状态反馈）

2. **手机网页端(HTML5)**
   - 使用nipple.js创建双摇杆控制器 
   - 摇杆1(Y轴): 驱动电机速度(-90~90)
   - 摇杆2(X轴): 转向角度(-100~100) 
   - 50ms/次采样率，变化量>5%时发送数据
   - 实时显示网络延迟

3. **ESP8266固件(Arduino)**
   - 前轮转向电机控制 + 后轮驱动电机控制
   - 设备状态上报（电压/信号强度）
   - 断线自动重连（指数退避算法）

## 控制原理

小车采用两个电机控制:
- 前电机: 控制前轮的转向，通过改变方向和PWM控制转向角度和速度
- 后电机: 控制后轮的前进后退，通过PWM控制行驶速度

## 安装和使用

### 服务器配置

1. 进入服务器目录并安装依赖：
```bash
cd cursor-ESP8266/server
npm install
```

2. 配置环境变量（端口等）：
```bash
cp .env.example .env
# 编辑.env文件
```

3. 启动服务器：
```bash
npm start
```

### 手机客户端

1. 服务器启动后，使用手机浏览器访问服务器地址
2. 选择可用设备并连接
3. 使用双摇杆控制小车移动

### ESP8266固件烧录

1. 使用Arduino IDE打开`cursor-ESP8266/esp8266-firmware/esp8266-firmware.ino`
2. 安装必要的库：
   - WebSocketsClient
   - ArduinoJson
   - ESP8266WiFi

3. 修改配置信息：
   - WiFi名称和密码
   - 服务器地址和端口
   - 设备ID和密钥

4. 烧录固件到ESP8266板子

## 硬件连接

ESP8266与L298N电机驱动模块接线：

### 转向电机控制（前轮）
- D1(GPIO5): 转向电机输入1 (IN1) 
- D2(GPIO4): 转向电机输入2 (IN2)
- D6(GPIO14): 转向电机使能 (ENA)

### 驱动电机控制（后轮）
- D3(GPIO0): 驱动电机输入1 (IN3)
- D4(GPIO2): 驱动电机输入2 (IN4)
- D5(GPIO12): 驱动电机使能 (ENB)

### 其他连接
- A0: 电池电压检测（分压后）

## 注意事项

- 服务器需开放3000端口(WebSocket)和80端口(HTTP)
- ESP8266固件需要Arduino IDE 1.8.x或更高版本
- 实际应用中建议完善认证机制，增加数据加密等安全措施 
