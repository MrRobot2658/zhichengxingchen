# ✦ 知诚星辰智能 · 知诚星辰

**让机器人拥有温度**

知诚星辰智能（青岛）—— 专注消费级机器人大脑与机器人技能开发。首款产品 **Reachy Mini 桌面陪伴机器人**，定价 ¥1,999。

> 官网：https://zhichengxingchen.vercel.app
> GitHub：https://github.com/MrRobot2658/zhichengxingchen

---

## 📋 项目结构

```
zhichengxingchen-site/
├── index.html             # 官网首页（产品展示、视频区、定价、关于我们）
├── login.html             # 登录 + 注册页
├── order.html             # 下单 + 支付（三步流程）
├── account.html           # 个人中心（订单/地址/账号设置）
├── api/
│   └── index.js           # 后端 API（Vercel Serverless Function）
├── images/                # Reachy Mini 产品图片
├── package.json           # 依赖（@vercel/postgres, nodemailer, jsonwebtoken）
└── vercel.json            # Vercel 部署配置
```

## ✨ 功能总览

### 🏠 官网首页 `/`

| 板块 | 内容 |
|------|------|
| Hero | Reachy Mini 实拍 GIF + "让机器人拥有温度" |
| 产品展示 | 产品详情、规格、8 项功能亮点 |
| 视频区 | 6 个 YouTube 嵌入（官方宣传、评测、教程） |
| 研发方向 | 机器人大脑、机器人技能、Hermes Agent 集成 |
| 定价 | ¥1,999（含本体 + 小六系统 + 一年 OTA 更新） |
| 关于我们 | 公司介绍 + 联系信息 |

### 🔐 登录/注册 `/login.html`

- 邮箱密码登录
- 注册（昵称 / 邮箱 / 手机号 / 密码）
- JWT 鉴权，token 存 localStorage
- 已登录自动跳转个人中心

### 🛒 下单流程 `/order.html`

三步流程：
1. **填写信息** → 收货人、手机号、地址、数量
2. **支付** → 选择支付宝或微信支付
3. **完成** → 显示订单号，发送确认邮件

### 👤 个人中心 `/account.html`

竖排侧边栏布局：

| 菜单 | 功能 |
|------|------|
| 📦 我的订单 | 订单列表 → 点击查看详情 → 取消订单 |
| 📍 收货地址 | 地址列表 → 添加/删除地址，设置默认 |
| ⚙️ 账号设置 | 个人信息编辑（昵称/手机号）+ 修改密码 + 退出登录 |

### 🔧 后端 API

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/auth/register` | POST | 注册账号 |
| `/api/auth/login` | POST | 登录，返回 JWT |
| `/api/auth/change-password` | POST | 修改密码 |
| `/api/auth/update-profile` | POST | 更新个人信息 |
| `/api/orders` | GET/POST | 获取/创建订单 |
| `/api/orders/:id` | GET | 订单详情 |
| `/api/orders/:id/cancel` | POST | 取消订单 |
| `/api/payment/alipay` | POST | 创建支付宝支付单 |
| `/api/payment/wechat` | POST | 创建微信支付单 |
| `/api/payment/confirm` | POST | 确认支付 |
| `/api/addresses` | GET/POST | 地址管理 |
| `/api/me` | GET | 当前用户信息 |
| `/api/health` | GET | 健康检查 |

### 🤖 Reachy Mini 集成

配套技能：`reachy-companion`（见 Hermes Agent 配置）

```bash
pip install reachy-mini
companion idle start         # 后台存在感循环
companion youtube <url>      # YouTube 音频播放
companion speak <text>       # TTS 朗读
companion express <emotion>  # 情绪表达
```

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| **前端** | 纯 HTML/CSS/JS（无框架，暗色星云主题） |
| **后端** | Node.js Vercel Serverless Function |
| **数据库** | Vercel Postgres（Neon） |
| **鉴权** | JWT（jsonwebtoken） |
| **邮件** | Nodemailer + Gmail SMTP |
| **部署** | Vercel（GitHub 自动部署） |

## 🚀 部署

```bash
# 克隆
git clone https://github.com/MrRobot2658/zhichengxingchen.git
cd zhichengxingchen-site

# 安装依赖
npm install

# 前端直接开 index.html 即可
# 后端需要 Vercel 环境变量：
#   POSTGRES_URL, GMAIL_USER, GMAIL_APP_PASSWORD

# 部署
git push origin main  # Vercel 自动部署
```

## 📞 联系

- 📧 hello@zhichengxingchen.com
- 📍 中国 · 青岛
