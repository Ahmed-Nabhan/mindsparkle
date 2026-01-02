import React, { useState, useEffect } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView, 
  TouchableOpacity, 
  Linking,
  Alert,
  TextInput,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useDocument } from '../hooks/useDocument';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type LabsScreenProps = MainDrawerScreenProps<'Labs'>;

// Free online lab platforms organized by category
const LAB_PLATFORMS = {
  programming: [
    { id: 'replit', name: 'Replit', description: 'Online IDE for 50+ languages', url: 'https://replit.com', icon: '💻', tags: ['Python', 'JavaScript', 'Java', 'C++'], color: '#F26207' },
    { id: 'codesandbox', name: 'CodeSandbox', description: 'Web development environments', url: 'https://codesandbox.io', icon: '📦', tags: ['React', 'Vue', 'Angular', 'Node.js'], color: '#151515' },
    { id: 'codepen', name: 'CodePen', description: 'Front-end playground', url: 'https://codepen.io/pen/', icon: '✒️', tags: ['HTML', 'CSS', 'JavaScript'], color: '#000000' },
    { id: 'stackblitz', name: 'StackBlitz', description: 'Full-stack web IDE', url: 'https://stackblitz.com', icon: '⚡', tags: ['React', 'Angular', 'Vue'], color: '#1389FD' },
    { id: 'jsfiddle', name: 'JSFiddle', description: 'Quick JavaScript testing', url: 'https://jsfiddle.net', icon: '🎻', tags: ['HTML', 'CSS', 'JavaScript'], color: '#4679BD' },
    { id: 'onlinegdb', name: 'OnlineGDB', description: 'Debugger for C/C++/Python', url: 'https://www.onlinegdb.com', icon: '🐛', tags: ['C', 'C++', 'Python', 'Debug'], color: '#00984A' },
  ],
  datascience: [
    { id: 'colab', name: 'Google Colab', description: 'Free Jupyter notebooks with GPU', url: 'https://colab.research.google.com', icon: '🔬', tags: ['Python', 'ML', 'Data Science'], color: '#F9AB00' },
    { id: 'kaggle', name: 'Kaggle Notebooks', description: 'Data science with free GPU/TPU', url: 'https://www.kaggle.com/code', icon: '📊', tags: ['Python', 'R', 'ML'], color: '#20BEFF' },
    { id: 'deepnote', name: 'Deepnote', description: 'Collaborative data notebook', url: 'https://deepnote.com', icon: '📓', tags: ['Python', 'SQL'], color: '#3793EF' },
    { id: 'observable', name: 'Observable', description: 'Data visualization notebooks', url: 'https://observablehq.com', icon: '👁️', tags: ['D3.js', 'Visualization'], color: '#3B5FC0' },
    { id: 'datalore', name: 'JetBrains Datalore', description: 'Smart data analysis', url: 'https://datalore.jetbrains.com', icon: '🧪', tags: ['Python', 'ML'], color: '#087CFA' },
    { id: 'huggingface', name: 'Hugging Face Spaces', description: 'ML demo hosting', url: 'https://huggingface.co/spaces', icon: '🤗', tags: ['AI', 'ML Models'], color: '#FFD21E' },
  ],
  database: [
    { id: 'sqlfiddle', name: 'SQL Fiddle', description: 'Test SQL queries online', url: 'http://sqlfiddle.com', icon: '🗄️', tags: ['SQL', 'MySQL', 'PostgreSQL'], color: '#E48E00' },
    { id: 'mongoplayground', name: 'Mongo Playground', description: 'Test MongoDB queries', url: 'https://mongoplayground.net', icon: '🍃', tags: ['MongoDB', 'NoSQL'], color: '#00ED64' },
    { id: 'dbfiddle', name: 'DB Fiddle', description: 'Multi-database playground', url: 'https://www.db-fiddle.com', icon: '🎯', tags: ['MySQL', 'PostgreSQL', 'SQLite'], color: '#3E78B2' },
    { id: 'planetscale', name: 'PlanetScale', description: 'Serverless MySQL', url: 'https://planetscale.com', icon: '🪐', tags: ['MySQL', 'Serverless'], color: '#000000' },
    { id: 'redis', name: 'Try Redis', description: 'Redis online playground', url: 'https://try.redis.io', icon: '🔴', tags: ['Redis', 'Cache'], color: '#DC382D' },
  ],
  devops: [
    { id: 'killercoda', name: 'Killercoda', description: 'Free Kubernetes & Linux labs', url: 'https://killercoda.com', icon: '☸️', tags: ['K8s', 'Docker', 'Linux'], color: '#326CE5' },
    { id: 'playwithdocker', name: 'Play with Docker', description: 'Free Docker playground', url: 'https://labs.play-with-docker.com', icon: '🐳', tags: ['Docker', 'Containers'], color: '#2496ED' },
    { id: 'gitpod', name: 'Gitpod', description: 'Cloud dev environments', url: 'https://gitpod.io', icon: '🟠', tags: ['Git', 'Cloud IDE'], color: '#FFB45B' },
    { id: 'playwitk8s', name: 'Play with K8s', description: 'Free Kubernetes clusters', url: 'https://labs.play-with-k8s.com', icon: '☸️', tags: ['Kubernetes', 'Containers'], color: '#326CE5' },
    { id: 'katacoda', name: 'O\'Reilly Labs', description: 'Interactive tech tutorials', url: 'https://learning.oreilly.com/scenarios', icon: '📚', tags: ['DevOps', 'Cloud'], color: '#D3002D' },
    { id: 'github', name: 'GitHub Codespaces', description: 'Dev containers in cloud', url: 'https://github.com/codespaces', icon: '🐙', tags: ['Git', 'VSCode'], color: '#181717' },
  ],
  cybersecurity: [
    { id: 'tryhackme', name: 'TryHackMe', description: 'Learn cybersecurity hands-on', url: 'https://tryhackme.com', icon: '🎭', tags: ['Security', 'Hacking', 'CTF'], color: '#212C42' },
    { id: 'hackthebox', name: 'Hack The Box', description: 'Cybersecurity training labs', url: 'https://www.hackthebox.com', icon: '📦', tags: ['Security', 'Pentesting'], color: '#9FEF00' },
    { id: 'overthewire', name: 'OverTheWire', description: 'Security war games', url: 'https://overthewire.org/wargames/', icon: '⚔️', tags: ['Linux', 'Security'], color: '#4A4A4A' },
    { id: 'picoctf', name: 'picoCTF', description: 'Beginner CTF challenges', url: 'https://picoctf.org', icon: '🏴', tags: ['CTF', 'Beginner'], color: '#2C3E50' },
    { id: 'portswigger', name: 'PortSwigger Labs', description: 'Web security academy', url: 'https://portswigger.net/web-security', icon: '🔒', tags: ['Web Security', 'OWASP'], color: '#FF6633' },
    { id: 'ctftime', name: 'CTFtime', description: 'CTF competitions directory', url: 'https://ctftime.org', icon: '🏆', tags: ['CTF', 'Competitions'], color: '#E84545' },
  ],
  algorithms: [
    { id: 'leetcode', name: 'LeetCode', description: 'Coding interview practice', url: 'https://leetcode.com', icon: '🧩', tags: ['Algorithms', 'Interviews'], color: '#FFA116' },
    { id: 'hackerrank', name: 'HackerRank', description: 'Coding challenges', url: 'https://www.hackerrank.com', icon: '💚', tags: ['Algorithms', 'Skills'], color: '#00EA64' },
    { id: 'codewars', name: 'Codewars', description: 'Practice with kata', url: 'https://www.codewars.com', icon: '⚔️', tags: ['Kata', 'Practice'], color: '#B1361E' },
    { id: 'exercism', name: 'Exercism', description: 'Free practice with mentorship', url: 'https://exercism.org', icon: '🏋️', tags: ['60+ Languages'], color: '#604FCD' },
    { id: 'codeforces', name: 'Codeforces', description: 'Competitive programming', url: 'https://codeforces.com', icon: '🏅', tags: ['Competitive', 'Contests'], color: '#1F8ACB' },
    { id: 'atcoder', name: 'AtCoder', description: 'Japanese CP platform', url: 'https://atcoder.jp', icon: '🎌', tags: ['Competitive', 'Contests'], color: '#222222' },
    { id: 'projecteuler', name: 'Project Euler', description: 'Math programming problems', url: 'https://projecteuler.net', icon: '🧮', tags: ['Math', 'Algorithms'], color: '#8B4513' },
  ],
  cloud: [
    { id: 'awsfree', name: 'AWS Free Tier', description: 'Amazon cloud services', url: 'https://aws.amazon.com/free', icon: '☁️', tags: ['AWS', 'Cloud'], color: '#FF9900' },
    { id: 'gcpfree', name: 'Google Cloud Free', description: 'GCP free tier resources', url: 'https://cloud.google.com/free', icon: '🌐', tags: ['GCP', 'Cloud'], color: '#4285F4' },
    { id: 'azurefree', name: 'Azure Free Account', description: 'Microsoft cloud services', url: 'https://azure.microsoft.com/free', icon: '🔷', tags: ['Azure', 'Cloud'], color: '#0089D6' },
    { id: 'vercel', name: 'Vercel', description: 'Frontend cloud platform', url: 'https://vercel.com', icon: '▲', tags: ['Frontend', 'Serverless'], color: '#000000' },
    { id: 'railway', name: 'Railway', description: 'Deploy apps instantly', url: 'https://railway.app', icon: '🚂', tags: ['Deploy', 'Backend'], color: '#0B0D0E' },
    { id: 'render', name: 'Render', description: 'Cloud hosting platform', url: 'https://render.com', icon: '🎨', tags: ['Hosting', 'Deploy'], color: '#46E3B7' },
  ],
  mobile: [
    { id: 'snack', name: 'Expo Snack', description: 'React Native playground', url: 'https://snack.expo.dev', icon: '📱', tags: ['React Native', 'Mobile'], color: '#000020' },
    { id: 'appetize', name: 'Appetize.io', description: 'iOS/Android emulator', url: 'https://appetize.io', icon: '🍎', tags: ['iOS', 'Android', 'Testing'], color: '#03C3EC' },
    { id: 'flutlab', name: 'FlutLab', description: 'Flutter online IDE', url: 'https://flutlab.io', icon: '🦋', tags: ['Flutter', 'Dart'], color: '#02569B' },
    { id: 'dartpad', name: 'DartPad', description: 'Dart/Flutter playground', url: 'https://dartpad.dev', icon: '🎯', tags: ['Dart', 'Flutter'], color: '#0175C2' },
  ],
  networking: [
    { id: 'gns3', name: 'GNS3 Academy', description: 'Network simulation & training', url: 'https://gns3.com/academy', icon: '🌐', tags: ['Cisco', 'Routing', 'Switching'], color: '#00A3E0' },
    { id: 'packettracer', name: 'Packet Tracer', description: 'Cisco network simulator', url: 'https://www.netacad.com/courses/packet-tracer', icon: '📡', tags: ['Cisco', 'CCNA', 'Network'], color: '#1BA0D7' },
    { id: 'eve-ng', name: 'EVE-NG Community', description: 'Multi-vendor network emulator', url: 'https://www.eve-ng.net', icon: '🔧', tags: ['Network', 'Multi-vendor', 'Lab'], color: '#4CAF50' },
    { id: 'labex', name: 'LabEx Networking', description: 'Hands-on network labs', url: 'https://labex.io/courses/linux-networking', icon: '🖥️', tags: ['Linux', 'Networking', 'Hands-on'], color: '#FF6B6B' },
    { id: 'ipspace', name: 'ipSpace Labs', description: 'Network automation labs', url: 'https://my.ipspace.net/bin/list?id=NetAutSol', icon: '⚙️', tags: ['Automation', 'SDN', 'Network'], color: '#2196F3' },
    { id: 'subnetting', name: 'Subnet Calculator', description: 'Practice subnetting online', url: 'https://www.subnet-calculator.com', icon: '🔢', tags: ['Subnetting', 'IP', 'CIDR'], color: '#9C27B0' },
    { id: 'wireshark', name: 'Wireshark SampleCaptures', description: 'Packet analysis practice', url: 'https://wiki.wireshark.org/SampleCaptures', icon: '🦈', tags: ['Wireshark', 'Packets', 'Analysis'], color: '#1679A7' },
    { id: 'practicalnetworking', name: 'Practical Networking', description: 'Network fundamentals labs', url: 'https://www.practicalnetworking.net', icon: '📚', tags: ['Fundamentals', 'Routing', 'Switching'], color: '#FF9800' },
    { id: 'networklessons', name: 'NetworkLessons', description: 'Cisco & Juniper labs', url: 'https://networklessons.com', icon: '📖', tags: ['Cisco', 'Juniper', 'BGP'], color: '#E91E63' },
    { id: 'boson', name: 'Boson NetSim', description: 'Cisco exam simulator', url: 'https://www.boson.com/netsim-cisco-network-simulator', icon: '🎓', tags: ['CCNA', 'CCNP', 'Exam'], color: '#3F51B5' },
  ],
};

const CATEGORIES = [
  { id: 'all', name: 'All', icon: '🌟' },
  { id: 'programming', name: 'Programming', icon: '💻' },
  { id: 'datascience', name: 'Data Science', icon: '📊' },
  { id: 'database', name: 'Databases', icon: '🗄️' },
  { id: 'networking', name: 'Networking', icon: '🌐' },
  { id: 'devops', name: 'DevOps', icon: '🐳' },
  { id: 'cybersecurity', name: 'Security', icon: '🔐' },
  { id: 'algorithms', name: 'Algorithms', icon: '🧩' },
  { id: 'cloud', name: 'Cloud', icon: '☁️' },
  { id: 'mobile', name: 'Mobile', icon: '📱' },
];

export const LabsScreen: React.FC = () => {
  const route = useRoute<LabsScreenProps['route']>();
  const { getDocument } = useDocument();
  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadDocument();
  }, []);

  const loadDocument = async () => {
    if (route.params?.documentId) {
      const doc = await getDocument(route.params.documentId);
      setDocument(doc);
    }
    setIsLoading(false);
  };

  const openLab = async (url: string, name: string) => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Error', `Failed to open ${name}`);
    }
  };

  const getFilteredPlatforms = () => {
    let platforms: any[] = [];
    if (selectedCategory === 'all') {
      Object.values(LAB_PLATFORMS).forEach(category => {
        platforms = [...platforms, ...category];
      });
    } else {
      platforms = LAB_PLATFORMS[selectedCategory as keyof typeof LAB_PLATFORMS] || [];
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      platforms = platforms.filter(p => 
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.tags.some((t: string) => t.toLowerCase().includes(query))
      );
    }
    return platforms;
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading labs..." />;
  }

  const filteredPlatforms = getFilteredPlatforms();

  return (
    <View style={styles.container}>
      <Header 
        title="Interactive Labs" 
        subtitle={document ? `For: ${document.title}` : 'Free online practice platforms'} 
      />
      
      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search labs (Python, Docker, SQL...)"
            placeholderTextColor={colors.textLight}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Category Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryScroll}>
          {CATEGORIES.map(category => (
            <TouchableOpacity
              key={category.id}
              style={[styles.categoryPill, selectedCategory === category.id && styles.categoryPillActive]}
              onPress={() => setSelectedCategory(category.id)}
            >
              <Text style={styles.categoryIcon}>{category.icon}</Text>
              <Text style={[styles.categoryText, selectedCategory === category.id && styles.categoryTextActive]}>
                {category.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={styles.resultsText}>{filteredPlatforms.length} labs found</Text>

        {/* Lab Cards */}
        <View style={styles.labsGrid}>
          {filteredPlatforms.map(platform => (
            <TouchableOpacity
              key={platform.id}
              style={styles.labCard}
              onPress={() => openLab(platform.url, platform.name)}
            >
              <View style={[styles.labIconContainer, { backgroundColor: platform.color + '20' }]}>
                <Text style={styles.labIcon}>{platform.icon}</Text>
              </View>
              <View style={styles.labInfo}>
                <Text style={styles.labName}>{platform.name}</Text>
                <Text style={styles.labDescription} numberOfLines={2}>{platform.description}</Text>
                <View style={styles.tagContainer}>
                  {platform.tags.slice(0, 3).map((tag: string, index: number) => (
                    <View key={index} style={[styles.tag, { backgroundColor: platform.color + '15' }]}>
                      <Text style={[styles.tagText, { color: platform.color }]}>{tag}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <Text style={styles.openIcon}>→</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Help Section */}
        <View style={styles.helpSection}>
          <Text style={styles.helpTitle}>💡 How to Use</Text>
          <Text style={styles.helpText}>
            1. Search or browse by category{'\n'}
            2. Tap any lab to open in browser{'\n'}
            3. Most are free - sign up if needed{'\n'}
            4. Practice concepts from your studies!
          </Text>
        </View>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1 },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    margin: 16,
    marginBottom: 8,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchIcon: { fontSize: 18, marginRight: 10 },
  searchInput: { flex: 1, paddingVertical: 14, fontSize: 16, color: colors.text },
  categoryScroll: { maxHeight: 50, paddingHorizontal: 12 },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.card,
    borderRadius: 20,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  categoryPillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  categoryIcon: { fontSize: 14, marginRight: 6 },
  categoryText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  categoryTextActive: { color: '#fff' },
  resultsText: { fontSize: 13, color: colors.textSecondary, marginLeft: 16, marginTop: 12, marginBottom: 8 },
  labsGrid: { paddingHorizontal: 16 },
  labCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  labIconContainer: { width: 50, height: 50, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  labIcon: { fontSize: 26 },
  labInfo: { flex: 1 },
  labName: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  labDescription: { fontSize: 13, color: colors.textSecondary, lineHeight: 18, marginBottom: 8 },
  tagContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  tagText: { fontSize: 11, fontWeight: '500' },
  openIcon: { fontSize: 20, color: colors.primary, marginLeft: 8 },
  helpSection: {
    backgroundColor: colors.card,
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  helpTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 8 },
  helpText: { fontSize: 14, color: colors.textSecondary, lineHeight: 22 },
  bottomPadding: { height: 40 },
  errorText: { fontSize: 16, color: colors.error, textAlign: 'center', marginTop: 32 },
});
