# MindSparkle Setup Guide

This guide will help you get MindSparkle up and running on your local machine.

## 📱 What You'll Build

MindSparkle is a cross-platform AI-powered learning app that includes:
- 12 fully functional screens
- AI integration with OpenAI (via Supabase proxy)
- Local SQLite database for offline storage
- Beautiful blue and gold color scheme
- Drawer + Stack navigation
- Document upload and management
- AI-generated summaries, quizzes, and study guides

## 🎯 Quick Start (5 Minutes)

### 1. Prerequisites Check

Make sure you have these installed:

```bash
# Check Node.js (need v16+)
node --version

# Check npm
npm --version

# Install Expo CLI globally
npm install -g expo-cli
```

### 2. Clone and Install

```bash
git clone https://github.com/Ahmed-Nabhan/mindsparkle.git
cd mindsparkle
npm install
```

### 3. Configure Environment

```bash
# Copy the example env file
cp .env.example .env

# Edit .env with your credentials (or use placeholders for now)
# For testing, the placeholder values will work for UI navigation
```

### 4. Run the App

```bash
# Start Expo development server
npx expo start

# Then press:
# 'i' for iOS simulator
# 'a' for Android emulator
# 'w' for web browser
```

## 🔧 Detailed Setup

### Setting Up Supabase (Optional - for full AI features)

1. Go to [supabase.com](https://supabase.com) and create a free account
2. Create a new project
3. Get your credentials from Project Settings > API:
   - Project URL
   - Anon/Public Key
4. Update your `.env` file:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

### Setting Up OpenAI Proxy (Optional - for AI features)

1. Create a Supabase Edge Function to proxy OpenAI requests
2. Example Edge Function code:

```typescript
// supabase/functions/openai-proxy/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { Configuration, OpenAIApi } from "https://esm.sh/openai@3.1.0"

const openai = new OpenAIApi(
  new Configuration({ apiKey: Deno.env.get('OPENAI_API_KEY') })
)

serve(async (req) => {
  // Handle summarization, quiz generation, etc.
  // Return AI-generated content
})
```

3. Deploy the function and update `.env`:

```env
OPENAI_API_PROXY_URL=https://your-project.supabase.co/functions/v1/openai-proxy
```

## 📱 Testing on Physical Devices

### iOS (Requires Mac)

1. Install Xcode from App Store
2. Open iOS Simulator
3. Run: `npx expo start` and press 'i'

### Android

1. Install Android Studio
2. Set up an Android Virtual Device (AVD)
3. Run: `npx expo start` and press 'a'

### Physical Device (Easiest!)

1. Install "Expo Go" app from App Store or Play Store
2. Run: `npx expo start`
3. Scan the QR code with your phone

## 🎨 Customization

### Change Colors

Edit `src/constants/colors.ts`:

```typescript
export const colors = {
  primary: '#1E3A8A',    // Your brand color
  secondary: '#7C3AED',   // Accent color
  accent: '#F59E0B',      // Sparkle color
  // ...
};
```

### Add Custom Screens

1. Create screen file in `src/screens/YourScreen.tsx`
2. Add route in `src/navigation/AppNavigator.tsx`
3. Add to drawer menu if needed

### Modify App Name

Edit `app.json`:

```json
{
  "expo": {
    "name": "Your App Name",
    "slug": "your-app-slug"
  }
}
```

## 🐛 Troubleshooting

### "Cannot find module" errors

```bash
# Clear cache and reinstall
rm -rf node_modules package-lock.json
npm install
npx expo start -c
```

### TypeScript errors

```bash
# Check for errors
npx tsc --noEmit
```

### Expo issues

```bash
# Clear Expo cache
npx expo start -c

# Check project health
npx expo-doctor
```

### Build fails

```bash
# Make sure you have the right SDK version
npx expo install --check
```

## 📚 Project Structure Overview

```
src/
├── components/       # Reusable UI components
├── constants/        # Colors, config, strings
├── context/          # React context (Auth, Documents, Theme)
├── hooks/           # Custom React hooks
├── navigation/      # Navigation setup
├── screens/         # App screens (12 total)
├── services/        # API and database services
├── types/           # TypeScript type definitions
└── utils/           # Helper functions
```

## 🚀 Next Steps

1. **Add Real Assets**: Replace placeholder images in `assets/images/`
   - logo.png (1024x1024)
   - sparkle-bg.png (for home screen)
   - welcome-animation.json (Lottie animation)

2. **Implement AI Features**: Set up Supabase Edge Functions for AI

3. **Add Authentication**: Enable Supabase Auth in your project

4. **Customize Branding**: Update colors, fonts, and copy

5. **Add Tests**: Write unit tests for components and services

6. **Deploy**: Build and deploy to App Store / Play Store

## 📖 Learn More

- [Expo Documentation](https://docs.expo.dev/)
- [React Navigation](https://reactnavigation.org/)
- [Supabase Docs](https://supabase.com/docs)
- [React Native Paper](https://callstack.github.io/react-native-paper/)

## 💬 Need Help?

- Open an issue on GitHub
- Check existing issues for solutions
- Join the Expo community Discord

---

Happy coding! 🎉
