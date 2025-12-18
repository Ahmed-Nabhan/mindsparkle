# MindSparkle

AI-powered learning app for iOS and Android. Study large documents through AI summarization, quizzes, video generation, and lab integrations.

![MindSparkle](https://img.shields.io/badge/version-1.0.0-blue)
![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

## 🌟 Features

- **AI Summarization**: Generate concise summaries of your documents
- **Study Mode**: AI-assisted learning with personalized study guides
- **AI Video Generation**: Create video summaries from your documents
- **Interactive Quizzes**: Test your knowledge with AI-generated questions
- **Performance Tracking**: Monitor your learning progress
- **Exam Preparation**: Practice with exam-style questions
- **Interview Tests**: Prepare for technical interviews
- **Labs Integration**: Access to interactive labs and exercises

## 🚀 Tech Stack

- **Framework**: Expo (React Native)
- **Language**: TypeScript
- **Navigation**: React Navigation (Drawer + Stack)
- **UI Library**: React Native Paper
- **Local Storage**: expo-sqlite
- **Backend**: Supabase (Auth, Edge Functions for AI proxy)
- **AI**: OpenAI GPT API (via secure proxy)
- **In-App Purchases**: RevenueCat (placeholder)

## 📋 Prerequisites

Before you begin, ensure you have the following installed:

- Node.js (v16 or higher)
- npm or yarn
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (for Mac) or Android Studio (for Android development)

## 🛠️ Installation

1. **Clone the repository**

```bash
git clone https://github.com/Ahmed-Nabhan/mindsparkle.git
cd mindsparkle
```

2. **Install dependencies**

```bash
npm install
```

3. **Set up environment variables**

Copy the `.env.example` file to `.env` and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
OPENAI_API_PROXY_URL=your_supabase_edge_function_url
```

4. **Add required assets** (Optional)

Place the following assets in the `assets/images/` directory:
- `logo.png` - App logo
- `sparkle-bg.png` - Homepage background
- `welcome-animation.json` - Lottie animation for welcome screen

## 🏃‍♂️ Running the App

### Start the development server

```bash
npx expo start
```

### Run on iOS Simulator

```bash
# Press 'i' in the terminal after starting expo
# Or run:
npm run ios
```

### Run on Android Emulator

```bash
# Press 'a' in the terminal after starting expo
# Or run:
npm run android
```

### Run on Web

```bash
# Press 'w' in the terminal after starting expo
# Or run:
npm run web
```

## 📁 Project Structure

```
mindsparkle/
├── App.tsx                 # Main app entry point
├── app.json               # Expo configuration
├── babel.config.js        # Babel configuration
├── tsconfig.json          # TypeScript configuration
├── package.json           # Dependencies
├── .env.example           # Environment variables template
│
├── src/
│   ├── navigation/        # Navigation configuration
│   ├── screens/           # App screens
│   ├── components/        # Reusable components
│   ├── services/          # API and service layer
│   ├── hooks/             # Custom React hooks
│   ├── context/           # React context providers
│   ├── constants/         # App constants and configuration
│   ├── types/             # TypeScript type definitions
│   └── utils/             # Utility functions
│
└── assets/                # Images, fonts, and other assets
```

## 🎨 Color Scheme

- **Primary (Headers/Buttons)**: Deep Blue `#1E3A8A`
- **Secondary**: Electric Purple `#7C3AED`
- **Accent (Sparkle)**: Gold/Yellow `#F59E0B`
- **Background**: Clean White `#FFFFFF`
- **Text**: Dark Gray `#1F2937`
- **Success**: Green `#10B981`

## 🔧 Configuration

### Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Get your project URL and anon key from Project Settings > API
3. Add them to your `.env` file

### OpenAI Integration

The app uses OpenAI's GPT API through a Supabase Edge Function for security. You'll need to:

1. Create a Supabase Edge Function to proxy OpenAI requests
2. Add your OpenAI API key to the Edge Function environment
3. Update the `OPENAI_API_PROXY_URL` in your `.env` file

## 📱 Screens

- **Welcome Screen**: Animated greeting
- **Home Screen**: Main landing page
- **Upload Screen**: Document upload and management
- **Document Actions**: Choose actions for your document
- **Summary Screen**: AI-generated summaries
- **Study Screen**: AI-assisted study mode
- **Video Screen**: AI video generation
- **Test Screen**: Interactive quizzes
- **Labs Screen**: External labs integration
- **Performance Screen**: Learning progress tracking
- **Exams Screen**: Exam preparation
- **Interview Screen**: Interview test preparation

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- React Native and Expo teams
- Supabase for backend services
- OpenAI for AI capabilities

## 📞 Support

For support, please open an issue in the GitHub repository.

---

Made with ❤️ by Ahmed Nabhan

