/**
 * Validate email address
 */
export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Validate password strength
 */
export const isValidPassword = (password: string): boolean => {
  // At least 8 characters
  return password.length >= 8;
};

/**
 * Validate file type
 */
export const isValidFileType = (fileName: string, allowedTypes: string[]): boolean => {
  const extension = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  return allowedTypes.includes(extension);
};

/**
 * Validate file size
 */
export const isValidFileSize = (fileSize: number, maxSize: number): boolean => {
  return fileSize <= maxSize;
};

/**
 * Validate required field
 */
export const isRequired = (value: string): boolean => {
  return value.trim().length > 0;
};
