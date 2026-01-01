export const config = {
  app: {
    name: 'MindSparkle',
    version: '1.0.0',
    description: 'AI-powered learning app',
  },
  animation: {
    welcomeScreenDuration: 3000,
    defaultTransitionDuration: 300,
  },
  limits: {
    maxDocumentSize: 10 * 1024 * 1024 * 1024, // 10 GB
    maxDocuments: 100,
    freeUserQuizLimit: 5,
  },
  supportedFileTypes: {
    documents: ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt'],
    images: ['.png', '.jpg', '.jpeg'],
  },
};
