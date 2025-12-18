export const config = {
  app: {
    name: 'MindSparkle',
    version: '1.0.0',
    description: 'AI-powered learning app',
  },
  animation: {
    welcomeScreenDuration: 3000, // 3 seconds
    defaultTransitionDuration: 300,
  },
  limits: {
    maxDocumentSize: 10 * 1024 * 1024, // 10 MB
    maxDocuments: 100,
    freeUserQuizLimit: 5,
  },
  supportedFileTypes: {
    documents: ['.pdf', '.doc', '.docx', '.txt'],
    images: ['.png', '.jpg', '.jpeg'],
  },
};
