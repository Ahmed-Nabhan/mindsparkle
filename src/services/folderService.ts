// Folder Service - Document organization with folders and tags

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@mindsparkle_folders';

export interface Folder {
  id: string;
  name: string;
  emoji: string;
  color: string;
  documentIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentTag {
  id: string;
  name: string;
  color: string;
}

// Predefined folder colors
export const FOLDER_COLORS = [
  '#EF4444', // Red
  '#F97316', // Orange
  '#F59E0B', // Amber
  '#84CC16', // Lime
  '#22C55E', // Green
  '#14B8A6', // Teal
  '#06B6D4', // Cyan
  '#3B82F6', // Blue
  '#6366F1', // Indigo
  '#8B5CF6', // Violet
  '#A855F7', // Purple
  '#EC4899', // Pink
];

// Predefined folder emojis
export const FOLDER_EMOJIS = [
  '📚', '📖', '📝', '📓', '📕', '📗', '📘', '📙',
  '🎓', '🎯', '💡', '⭐', '🔥', '💪', '🧠', '🌟',
  '📊', '📈', '🔬', '⚗️', '🧪', '💻', '🎨', '🎵',
  '🌍', '🏛️', '⚖️', '💼', '🩺', '🔧', '📐', '✏️',
];

class FolderService {
  private folders: Folder[] = [];

  // Initialize and load folders
  async initialize(): Promise<Folder[]> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEY);
      if (data) {
        this.folders = JSON.parse(data).map((f: any) => ({
          ...f,
          createdAt: new Date(f.createdAt),
          updatedAt: new Date(f.updatedAt),
        }));
      }
      return this.folders;
    } catch (error) {
      console.error('Error loading folders:', error);
      return [];
    }
  }

  // Save folders to storage
  private async saveFolders(): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.folders));
    } catch (error) {
      console.error('Error saving folders:', error);
    }
  }

  // Create a new folder
  async createFolder(name: string, emoji: string = '📁', color: string = FOLDER_COLORS[0]): Promise<Folder> {
    const newFolder: Folder = {
      id: `folder_${Date.now()}`,
      name,
      emoji,
      color,
      documentIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.folders.push(newFolder);
    await this.saveFolders();
    return newFolder;
  }

  // Update a folder
  async updateFolder(folderId: string, updates: Partial<Omit<Folder, 'id' | 'createdAt'>>): Promise<Folder | null> {
    const index = this.folders.findIndex(f => f.id === folderId);
    if (index === -1) return null;

    this.folders[index] = {
      ...this.folders[index],
      ...updates,
      updatedAt: new Date(),
    };

    await this.saveFolders();
    return this.folders[index];
  }

  // Delete a folder
  async deleteFolder(folderId: string): Promise<boolean> {
    const index = this.folders.findIndex(f => f.id === folderId);
    if (index === -1) return false;

    this.folders.splice(index, 1);
    await this.saveFolders();
    return true;
  }

  // Add document to folder
  async addDocumentToFolder(folderId: string, documentId: string): Promise<boolean> {
    const folder = this.folders.find(f => f.id === folderId);
    if (!folder) return false;

    // Remove from other folders first
    await this.removeDocumentFromAllFolders(documentId);

    if (!folder.documentIds.includes(documentId)) {
      folder.documentIds.push(documentId);
      folder.updatedAt = new Date();
      await this.saveFolders();
    }
    return true;
  }

  // Remove document from folder
  async removeDocumentFromFolder(folderId: string, documentId: string): Promise<boolean> {
    const folder = this.folders.find(f => f.id === folderId);
    if (!folder) return false;

    const docIndex = folder.documentIds.indexOf(documentId);
    if (docIndex !== -1) {
      folder.documentIds.splice(docIndex, 1);
      folder.updatedAt = new Date();
      await this.saveFolders();
    }
    return true;
  }

  // Remove document from all folders
  async removeDocumentFromAllFolders(documentId: string): Promise<void> {
    for (const folder of this.folders) {
      const docIndex = folder.documentIds.indexOf(documentId);
      if (docIndex !== -1) {
        folder.documentIds.splice(docIndex, 1);
        folder.updatedAt = new Date();
      }
    }
    await this.saveFolders();
  }

  // Get all folders
  getAllFolders(): Folder[] {
    return [...this.folders].sort((a, b) => 
      b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  // Get folder by ID
  getFolderById(folderId: string): Folder | undefined {
    return this.folders.find(f => f.id === folderId);
  }

  // Get folder containing a document
  getFolderForDocument(documentId: string): Folder | undefined {
    return this.folders.find(f => f.documentIds.includes(documentId));
  }

  // Get uncategorized document IDs (not in any folder)
  getUncategorizedDocuments(allDocumentIds: string[]): string[] {
    const categorizedIds = new Set(
      this.folders.flatMap(f => f.documentIds)
    );
    return allDocumentIds.filter(id => !categorizedIds.has(id));
  }

  // Get folder count
  getFolderCount(): number {
    return this.folders.length;
  }

  // Search folders by name
  searchFolders(query: string): Folder[] {
    const lowerQuery = query.toLowerCase();
    return this.folders.filter(f => 
      f.name.toLowerCase().includes(lowerQuery)
    );
  }

  // Get suggested folder name based on document content
  suggestFolderName(documentTitle: string): string {
    const commonCategories: { [key: string]: string } = {
      'math': 'Mathematics',
      'algebra': 'Mathematics',
      'calculus': 'Mathematics',
      'geometry': 'Mathematics',
      'physics': 'Physics',
      'chemistry': 'Chemistry',
      'biology': 'Biology',
      'history': 'History',
      'english': 'English',
      'literature': 'Literature',
      'computer': 'Computer Science',
      'programming': 'Programming',
      'science': 'Science',
      'medical': 'Medical',
      'law': 'Law',
      'business': 'Business',
      'economics': 'Economics',
      'psychology': 'Psychology',
    };

    const lowerTitle = documentTitle.toLowerCase();
    for (const [keyword, category] of Object.entries(commonCategories)) {
      if (lowerTitle.includes(keyword)) {
        return category;
      }
    }
    return 'General';
  }
}

export const folderService = new FolderService();
export default folderService;
