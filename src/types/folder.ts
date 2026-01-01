import { Document } from '../types/document';

export interface Folder {
  id: string;
  name: string;
  emoji: string;
  color: string;
  documentIds: string[];
  createdAt: Date;
}
