/**
 * Validate email address
 */
export const isValidEmail = (email:  string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex. test(email);
};

/**
 * Validate password strength
 */
export const isValidPassword = (password: string): boolean => {
  return password.length >= 8;
};

/**
 * Validate file type
 */
export const isValidFileType = (fileName: string, allowedTypes: string[]): boolean => {
  if (! fileName) return false;
  
  const lowerFileName = fileName. toLowerCase();
  const extension = lowerFileName. substring(lowerFileName.lastIndexOf('. '));
  
  // Check extension
  const isValidExt = allowedTypes.some(function(type) {
    return type.toLowerCase() === extension;
  });
  
  if (isValidExt) return true;
  
  // Also check if filename contains known extensions (for edge cases)
  const validExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.txt'];
  return validExtensions.some(function(ext) {
    return lowerFileName.endsWith(ext);
  });
};

/**
 * Validate file size
 */
export const isValidFileSize = (fileSize:  number, maxSize:  number): boolean => {
  return fileSize <= maxSize;
};

/**
 * Validate required field
 */
export const isRequired = (value: string): boolean => {
  return value.trim().length > 0;
};
