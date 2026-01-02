/**
 * Knowledge Graph Service
 * 
 * Builds document knowledge relationships for enhanced learning
 * Tracks concepts, dependencies, and learning paths
 */

// ============================================
// TYPES
// ============================================

export interface KnowledgeNode {
  id: string;
  type: 'concept' | 'term' | 'procedure' | 'command' | 'topic';
  label: string;
  description?: string;
  pageRef?: number;
  vendor?: string;
  importance: 'critical' | 'important' | 'supplementary';
  mastered: boolean;
}

export interface KnowledgeEdge {
  source: string;  // Node ID
  target: string;  // Node ID
  type: 'requires' | 'related' | 'part-of' | 'example-of' | 'contrasts';
  strength: number; // 0-1
}

export interface KnowledgeGraph {
  documentId: string;
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  rootNodes: string[];  // Entry point nodes
  leafNodes: string[];  // Terminal nodes
  metadata: GraphMetadata;
}

export interface GraphMetadata {
  totalConcepts: number;
  totalRelationships: number;
  maxDepth: number;
  criticalPath: string[];  // Most important learning path
  createdAt: Date;
  vendor?: string;
}

export interface LearningPath {
  name: string;
  description: string;
  nodes: string[];  // Ordered node IDs
  estimatedTime: number; // minutes
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

export interface ConceptCluster {
  name: string;
  nodes: string[];
  centralConcept: string;
  relatedTopics: string[];
}

// ============================================
// KNOWLEDGE GRAPH BUILDER
// ============================================

export class KnowledgeGraphBuilder {
  private nodes: Map<string, KnowledgeNode> = new Map();
  private edges: KnowledgeEdge[] = [];
  private documentId: string = '';

  constructor(documentId: string) {
    this.documentId = documentId;
  }

  /**
   * Build knowledge graph from extracted content
   */
  build(
    content: string,
    vendor?: string,
    existingTerms?: { term: string; definition: string }[]
  ): KnowledgeGraph {
    this.nodes.clear();
    this.edges = [];

    // Extract concepts from content
    this.extractConcepts(content, vendor);

    // Add existing terms if provided
    if (existingTerms) {
      this.addTerms(existingTerms);
    }

    // Build relationships
    this.buildRelationships(content);

    // Identify root and leaf nodes
    const rootNodes = this.findRootNodes();
    const leafNodes = this.findLeafNodes();

    // Calculate critical path
    const criticalPath = this.calculateCriticalPath(rootNodes);

    return {
      documentId: this.documentId,
      nodes: Array.from(this.nodes.values()),
      edges: this.edges,
      rootNodes,
      leafNodes,
      metadata: {
        totalConcepts: this.nodes.size,
        totalRelationships: this.edges.length,
        maxDepth: this.calculateMaxDepth(rootNodes),
        criticalPath,
        createdAt: new Date(),
        vendor,
      },
    };
  }

  /**
   * Extract concepts from document content
   */
  private extractConcepts(content: string, vendor?: string): void {
    // Extract headings as topics (markdown format)
    const headingPattern = /^#+\s+(.+)$/gm;
    let match;
    while ((match = headingPattern.exec(content)) !== null) {
      const heading = match[1].trim();
      this.addNode({
        id: this.generateId(heading),
        type: 'topic',
        label: heading,
        importance: match[0].startsWith('# ') ? 'critical' : 'important',
        mastered: false,
        vendor,
      });
    }

    // Extract plain text section headers (lines ending with colon)
    const sectionPattern = /^([A-Z][A-Za-z\s]+):$/gm;
    while ((match = sectionPattern.exec(content)) !== null) {
      const section = match[1].trim();
      if (section.length > 3 && section.length < 80) {
        this.addNode({
          id: this.generateId(section),
          type: 'topic',
          label: section,
          importance: 'important',
          mastered: false,
          vendor,
        });
      }
    }

    // Extract capitalized terms (likely important concepts)
    const capsPattern = /\b([A-Z][A-Z0-9]{2,}(?:\s+[A-Z][A-Z0-9]+)*)\b/g;
    while ((match = capsPattern.exec(content)) !== null) {
      const term = match[1].trim();
      // Filter out common words and very short terms
      const skipWords = ['THE', 'AND', 'FOR', 'NOT', 'WITH', 'BUT', 'THIS', 'THAT', 'FROM', 'HAVE'];
      if (term.length >= 3 && !skipWords.includes(term)) {
        this.addNode({
          id: this.generateId(term),
          type: 'term',
          label: term,
          importance: 'important',
          mastered: false,
          vendor,
        });
      }
    }

    // Extract bold terms as key concepts
    const boldPattern = /\*\*([^*]+)\*\*/g;
    while ((match = boldPattern.exec(content)) !== null) {
      const term = match[1].trim();
      if (term.length > 2 && term.length < 100) {
        this.addNode({
          id: this.generateId(term),
          type: 'term',
          label: term,
          importance: 'important',
          mastered: false,
          vendor,
        });
      }
    }

    // Extract CLI commands (vendor-specific)
    const cliPatterns = [
      /^[A-Za-z0-9_-]+[#>]\s*(.+)$/gm,  // Cisco/network
      /^\s*Router[#>]\s*(.+)$/gm,        // Cisco Router
      /^\s*Switch[#>]\s*(.+)$/gm,        // Cisco Switch
      /^\s*R\d+[#>]\s*(.+)$/gm,          // Router numbered
      /^\$\s+(.+)$/gm,                   // Shell
      /^\s*aws\s+(.+)$/gm,               // AWS CLI
      /^\s*az\s+(.+)$/gm,                // Azure CLI
      /^\s*gcloud\s+(.+)$/gm,            // GCP CLI
    ];

    for (const pattern of cliPatterns) {
      while ((match = pattern.exec(content)) !== null) {
        const command = match[1]?.trim() || match[0].trim();
        if (command.length > 3) {
          this.addNode({
            id: this.generateId(`cmd_${command}`),
            type: 'command',
            label: command,
            importance: 'important',
            mastered: false,
            vendor,
          });
        }
      }
    }

    // Extract numbered procedures
    const procedurePattern = /^\d+\.\s+(.+)$/gm;
    let procedureGroup: string[] = [];
    while ((match = procedurePattern.exec(content)) !== null) {
      procedureGroup.push(match[1].trim());
    }
    
    if (procedureGroup.length >= 3) {
      const procedureName = `Procedure: ${procedureGroup[0].substring(0, 50)}...`;
      this.addNode({
        id: this.generateId(procedureName),
        type: 'procedure',
        label: procedureName,
        description: procedureGroup.join(' → '),
        importance: 'important',
        mastered: false,
        vendor,
      });
    }
  }

  /**
   * Add terms with definitions
   */
  private addTerms(terms: { term: string; definition: string }[]): void {
    for (const { term, definition } of terms) {
      this.addNode({
        id: this.generateId(term),
        type: 'term',
        label: term,
        description: definition,
        importance: 'important',
        mastered: false,
      });
    }
  }

  /**
   * Build relationships between nodes
   */
  private buildRelationships(content: string): void {
    const nodes = Array.from(this.nodes.values());
    const contentLower = content.toLowerCase();

    // Find co-occurring concepts (appear near each other in text)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const node1 = nodes[i];
        const node2 = nodes[j];

        // Check if they appear within 500 characters of each other
        const pos1 = contentLower.indexOf(node1.label.toLowerCase());
        const pos2 = contentLower.indexOf(node2.label.toLowerCase());

        if (pos1 !== -1 && pos2 !== -1) {
          const distance = Math.abs(pos1 - pos2);
          if (distance < 500) {
            const strength = 1 - (distance / 500);
            this.addEdge(node1.id, node2.id, 'related', strength);
          }
        }
      }
    }

    // Find hierarchical relationships (topics contain concepts)
    const topics = nodes.filter(n => n.type === 'topic');
    const concepts = nodes.filter(n => n.type !== 'topic');

    for (const topic of topics) {
      const topicPos = contentLower.indexOf(topic.label.toLowerCase());
      if (topicPos === -1) continue;

      // Find next topic position
      let nextTopicPos = content.length;
      for (const otherTopic of topics) {
        if (otherTopic.id === topic.id) continue;
        const pos = contentLower.indexOf(otherTopic.label.toLowerCase());
        if (pos > topicPos && pos < nextTopicPos) {
          nextTopicPos = pos;
        }
      }

      // Concepts between this topic and next belong to this topic
      for (const concept of concepts) {
        const conceptPos = contentLower.indexOf(concept.label.toLowerCase());
        if (conceptPos > topicPos && conceptPos < nextTopicPos) {
          this.addEdge(concept.id, topic.id, 'part-of', 0.8);
        }
      }
    }

    // Find prerequisite relationships based on common patterns
    const prereqPatterns = [
      /before\s+(.+?),?\s+you\s+(must|need|should)/gi,
      /requires?\s+knowledge\s+of\s+(.+)/gi,
      /assumes?\s+familiarity\s+with\s+(.+)/gi,
      /prerequisite:?\s+(.+)/gi,
    ];

    for (const pattern of prereqPatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const prereqText = match[1].toLowerCase();
        // Find matching node
        for (const node of nodes) {
          if (prereqText.includes(node.label.toLowerCase())) {
            // This node is a prerequisite for something
            // Mark it as foundational
            node.importance = 'critical';
          }
        }
      }
    }
  }

  /**
   * Add a node to the graph
   */
  private addNode(node: KnowledgeNode): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, node);
    }
  }

  /**
   * Add an edge to the graph
   */
  private addEdge(
    source: string,
    target: string,
    type: KnowledgeEdge['type'],
    strength: number
  ): void {
    // Avoid duplicate edges
    const exists = this.edges.some(
      e => e.source === source && e.target === target && e.type === type
    );
    if (!exists && source !== target) {
      this.edges.push({ source, target, type, strength });
    }
  }

  /**
   * Generate unique ID for a node
   */
  private generateId(label: string): string {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .substring(0, 50);
  }

  /**
   * Find root nodes (no incoming 'requires' edges)
   */
  private findRootNodes(): string[] {
    const hasIncoming = new Set<string>();
    for (const edge of this.edges) {
      if (edge.type === 'requires' || edge.type === 'part-of') {
        hasIncoming.add(edge.target);
      }
    }
    return Array.from(this.nodes.keys()).filter(id => !hasIncoming.has(id));
  }

  /**
   * Find leaf nodes (no outgoing 'requires' edges)
   */
  private findLeafNodes(): string[] {
    const hasOutgoing = new Set<string>();
    for (const edge of this.edges) {
      if (edge.type === 'requires') {
        hasOutgoing.add(edge.source);
      }
    }
    return Array.from(this.nodes.keys()).filter(id => !hasOutgoing.has(id));
  }

  /**
   * Calculate critical learning path
   */
  private calculateCriticalPath(rootNodes: string[]): string[] {
    const path: string[] = [];
    const visited = new Set<string>();

    // Start with critical importance nodes
    const criticalNodes = Array.from(this.nodes.values())
      .filter(n => n.importance === 'critical')
      .map(n => n.id);

    // BFS from roots through critical nodes
    const queue = [...rootNodes];
    while (queue.length > 0 && path.length < 10) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (node && (node.importance === 'critical' || criticalNodes.includes(nodeId))) {
        path.push(nodeId);
      }

      // Add connected nodes to queue
      for (const edge of this.edges) {
        if (edge.source === nodeId && !visited.has(edge.target)) {
          queue.push(edge.target);
        }
      }
    }

    return path;
  }

  /**
   * Calculate maximum depth of the graph
   */
  private calculateMaxDepth(rootNodes: string[]): number {
    let maxDepth = 0;
    const visited = new Set<string>();

    const dfs = (nodeId: string, depth: number) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      maxDepth = Math.max(maxDepth, depth);

      for (const edge of this.edges) {
        if (edge.source === nodeId) {
          dfs(edge.target, depth + 1);
        }
      }
    };

    for (const root of rootNodes) {
      dfs(root, 0);
    }

    return maxDepth;
  }
}

// ============================================
// LEARNING PATH GENERATOR
// ============================================

export class LearningPathGenerator {
  /**
   * Generate learning paths from knowledge graph
   */
  generatePaths(graph: KnowledgeGraph): LearningPath[] {
    const paths: LearningPath[] = [];

    // Generate beginner path (foundational concepts)
    const beginnerPath = this.generateBeginnerPath(graph);
    if (beginnerPath.nodes.length > 0) {
      paths.push(beginnerPath);
    }

    // Generate comprehensive path (all concepts)
    const comprehensivePath = this.generateComprehensivePath(graph);
    if (comprehensivePath.nodes.length > 0) {
      paths.push(comprehensivePath);
    }

    // Generate quick review path (critical only)
    const quickPath = this.generateQuickReviewPath(graph);
    if (quickPath.nodes.length > 0) {
      paths.push(quickPath);
    }

    return paths;
  }

  private generateBeginnerPath(graph: KnowledgeGraph): LearningPath {
    const nodes = graph.nodes
      .filter(n => n.importance === 'critical' || n.type === 'topic')
      .map(n => n.id);

    return {
      name: 'Beginner Path',
      description: 'Start here - covers fundamental concepts',
      nodes,
      estimatedTime: nodes.length * 5,
      difficulty: 'beginner',
    };
  }

  private generateComprehensivePath(graph: KnowledgeGraph): LearningPath {
    // Order nodes by importance, then by relationships
    const orderedNodes: string[] = [];
    const visited = new Set<string>();

    // Add critical nodes first
    for (const node of graph.nodes) {
      if (node.importance === 'critical' && !visited.has(node.id)) {
        orderedNodes.push(node.id);
        visited.add(node.id);
      }
    }

    // Add important nodes
    for (const node of graph.nodes) {
      if (node.importance === 'important' && !visited.has(node.id)) {
        orderedNodes.push(node.id);
        visited.add(node.id);
      }
    }

    // Add remaining nodes
    for (const node of graph.nodes) {
      if (!visited.has(node.id)) {
        orderedNodes.push(node.id);
        visited.add(node.id);
      }
    }

    return {
      name: 'Comprehensive Path',
      description: 'Complete coverage of all concepts',
      nodes: orderedNodes,
      estimatedTime: orderedNodes.length * 8,
      difficulty: 'advanced',
    };
  }

  private generateQuickReviewPath(graph: KnowledgeGraph): LearningPath {
    const nodes = graph.metadata.criticalPath;

    return {
      name: 'Quick Review',
      description: 'Essential concepts for quick revision',
      nodes,
      estimatedTime: nodes.length * 3,
      difficulty: 'intermediate',
    };
  }
}

// ============================================
// EXPORTS
// ============================================

export function createKnowledgeGraph(
  documentId: string,
  content: string,
  vendor?: string
): KnowledgeGraph {
  const builder = new KnowledgeGraphBuilder(documentId);
  return builder.build(content, vendor);
}

export function generateLearningPaths(graph: KnowledgeGraph): LearningPath[] {
  const generator = new LearningPathGenerator();
  return generator.generatePaths(graph);
}
