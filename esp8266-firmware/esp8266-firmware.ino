#include <ESP8266WiFi.h>
#include <WebSocketsClient.h>
#include <SocketIOclient.h>
#include <ArduinoJson.h>

// 配置
#define DEVICE_ID "ESP8266_001"
#define DEVICE_KEY "secret_key_001"
#define SERVER_HOST "192.168.31.105" // 替换为您的服务器IP或域名
#define SERVER_PORT 3000

// 引脚定义 - 前轮转向电机和后轮驱动电机
#define STEERING_IN1 5  // D1 - 转向电机方向控制1
#define STEERING_IN2 4  // D2 - 转向电机方向控制2
#define STEERING_ENA 14 // D6 - 转向电机PWM控制

#define DRIVE_IN1 0  // D3 - 驱动电机方向控制1
#define DRIVE_IN2 2  // D4 - 驱动电机方向控制2
#define DRIVE_ENB 12 // D5 - 驱动电机PWM控制

// 状态变量
bool isConnected = false;
unsigned long lastHeartbeat = 0;
unsigned long lastReconnectAttempt = 0;
int reconnectCount = 0;
const int maxReconnectDelay = 30000; // 最大重连延迟30秒

// 实例化对象 - 使用SocketIO客户端
SocketIOclient socketIO;

// WiFi连接配置
const char* ssid = "Redmi_E763";         // 修改为您的WiFi名称
const char* password = "12345678";     // 修改为您的WiFi密码

void setup() {
  // 初始化串口
  Serial.begin(115200);
  Serial.println("\nESP8266物联网小车控制系统启动");
  
  // 初始化引脚 - 转向电机
  pinMode(STEERING_ENA, OUTPUT);
  pinMode(STEERING_IN1, OUTPUT);
  pinMode(STEERING_IN2, OUTPUT);
  
  // 初始化引脚 - 驱动电机
  pinMode(DRIVE_ENB, OUTPUT);
  pinMode(DRIVE_IN1, OUTPUT);
  pinMode(DRIVE_IN2, OUTPUT);
  
  // 初始化PWM设置
  analogWriteFreq(5000); // 设置PWM频率为5kHz，减少电机噪声
  analogWriteRange(255); // 设置PWM范围为0-255
  
  // 连接WiFi
  connectToWiFi();
  
  // 设置SocketIO事件处理程序
  socketIO.begin(SERVER_HOST, SERVER_PORT);
  socketIO.onEvent(socketIOEvent);

  // 调试信息
  Serial.print("尝试连接到服务器: ");
  Serial.print(SERVER_HOST);
  Serial.print(":");
  Serial.println(SERVER_PORT);
}

void loop() {
  // 处理SocketIO事件
  socketIO.loop();
  
  // 检查WebSocket连接状态
  if (isConnected) {
    // 发送心跳包，每3秒发送一次设备状态
    if (millis() - lastHeartbeat > 3000) {
      sendStatus();
      lastHeartbeat = millis();
    }
  } else {
    // 断线重连逻辑（含指数退避）
    if (millis() - lastReconnectAttempt > getReconnectDelay()) {
      Serial.println("尝试重新连接到服务器...");
      socketIO.begin(SERVER_HOST, SERVER_PORT);
      lastReconnectAttempt = millis();
      reconnectCount++;
    }
  }
}

// 计算重连延迟（指数退避算法）
int getReconnectDelay() {
  int delay = 1000 * (1 << reconnectCount); // 2^reconnectCount 秒
  if (delay > maxReconnectDelay) {
    delay = maxReconnectDelay;
  }
  return delay;
}

// 连接WiFi网络
void connectToWiFi() {
  Serial.print("连接到 WiFi: ");
  Serial.println(ssid);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  
  // 等待WiFi连接
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  
  Serial.println("");
  Serial.println("WiFi 已连接");
  Serial.print("IP 地址: ");
  Serial.println(WiFi.localIP());
}

// SocketIO事件处理
void socketIOEvent(socketIOmessageType_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case sIOtype_DISCONNECT:
      Serial.println("与服务器断开连接");
      isConnected = false;
      break;
    
    case sIOtype_CONNECT:
      Serial.println("已连接到服务器");
      isConnected = true;
      reconnectCount = 0;
      
      // 发送设备认证
      sendAuth();
      break;
    
    case sIOtype_EVENT:
      handleEvent(payload, length);
      break;

    case sIOtype_ACK:
      Serial.println("收到ACK");
      break;
      
    case sIOtype_ERROR:
      Serial.println("连接错误");
      break;
      
    case sIOtype_BINARY_EVENT:
      Serial.println("收到二进制事件");
      break;
      
    case sIOtype_BINARY_ACK:
      Serial.println("收到二进制ACK");
      break;
  }
}

// 发送认证信息
void sendAuth() {
  DynamicJsonDocument doc(256);
  JsonArray array = doc.to<JsonArray>();
  
  array.add("auth");
  
  JsonObject param = array.createNestedObject();
  param["deviceId"] = DEVICE_ID;
  param["deviceKey"] = DEVICE_KEY;
  param["type"] = "device";
  
  String output;
  serializeJson(doc, output);
  socketIO.sendEVENT(output);
  
  Serial.println("发送认证请求");
}

// 发送设备状态
void sendStatus() {
  DynamicJsonDocument doc(256);
  JsonArray array = doc.to<JsonArray>();
  
  array.add("status");
  
  JsonObject param = array.createNestedObject();
  // 电压读取（模拟，实际应从ADC读取）
  float voltage = (analogRead(A0) / 1023.0) * 15.0; // 假设A0接分压器，满量程对应15V
  
  // WiFi信号强度
  int signalStrength = map(WiFi.RSSI(), -100, -40, 0, 100);
  if (signalStrength < 0) signalStrength = 0;
  if (signalStrength > 100) signalStrength = 100;
  
  param["voltage"] = voltage;
  param["signalStrength"] = signalStrength;
  
  String output;
  serializeJson(doc, output);
  socketIO.sendEVENT(output);
}

// 处理接收到的事件
void handleEvent(uint8_t * payload, size_t length) {
  String message = String((char*)payload);
  Serial.print("收到事件: ");
  Serial.println(message);
  
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, message);
  
  if (error) {
    Serial.print("解析JSON失败: ");
    Serial.println(error.c_str());
    return;
  }
  
  // 提取事件名称和数据
  String eventName = doc[0];
  
  if (eventName == "auth_response") {
    bool success = doc[1]["success"];
    if (success) {
      Serial.println("认证成功");
    } else {
      Serial.print("认证失败: ");
      Serial.println(doc[1]["message"].as<String>());
    }
  }
  else if (eventName == "command") {
    // 解析控制命令
    int speed = doc[1]["command"]["speed"];
    int direction = doc[1]["command"]["direction"];
    
    // 控制驱动和转向 - 交换控制关系
    setDriveSpeed(speed);         // 左侧摇杆控制后轮驱动(X轴输入)
    setSteeringAngle(direction);  // 右侧摇杆控制前轮转向(Y轴输入)
    
    Serial.print("收到命令 - 驱动(后轮): ");
    Serial.print(speed);
    Serial.print("%, 转向(前轮): ");
    Serial.println(direction);
  }
}

// 设置驱动电机速度 (-100 到 100)
void setDriveSpeed(int speed) {
  // 限制输入范围
  speed = constrain(speed, -100, 100);
  
  // 设置方向
  if (speed >= 0) {
    digitalWrite(DRIVE_IN1, HIGH);
    digitalWrite(DRIVE_IN2, LOW);
  } else {
    digitalWrite(DRIVE_IN1, LOW);
    digitalWrite(DRIVE_IN2, HIGH);
    speed = -speed; // 使速度为正值
  }
  
  // 映射 0-100 -> 0-255
  int pwmValue = map(speed, 0, 100, 0, 255);
  
  // 输出调试信息
  Serial.print("驱动电机 PWM: ");
  Serial.println(pwmValue);
  
  analogWrite(DRIVE_ENB, pwmValue);
}

// 设置转向角度 (-90 到 90)
void setSteeringAngle(int angle) {
  // 限制输入范围
  angle = constrain(angle, -90, 90);
  
  // 根据角度设置转向方向
  if (angle > 0) {
    // 右转
    digitalWrite(STEERING_IN1, HIGH);
    digitalWrite(STEERING_IN2, LOW);
  } else if (angle < 0) {
    // 左转
    digitalWrite(STEERING_IN1, LOW);
    digitalWrite(STEERING_IN2, HIGH);
    angle = -angle; // 使角度为正值
  } else {
    // 居中时停止转向电机
    digitalWrite(STEERING_IN1, LOW);
    digitalWrite(STEERING_IN2, LOW);
    analogWrite(STEERING_ENA, 0);
    return;
  }
  
  // 角度映射到PWM值，角度越大速度越快
  int steeringSpeed = map(angle, 0, 90, 50, 255);
  
  // 输出调试信息
  Serial.print("转向电机 PWM: ");
  Serial.println(steeringSpeed);
  
  analogWrite(STEERING_ENA, steeringSpeed);
} 
