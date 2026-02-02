// @ts-nocheck - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_CONTENT_LENGTH = 100000;
const MAX_MODULE_CONTENT_LENGTH = 120000;

// Hard cap to prevent runaway payloads. Above this we return 413.
// For anything above MAX_CONTENT_LENGTH but below this cap, we truncate server-side
// (most handlers already truncate internally anyway).
const HARD_CONTENT_LENGTH = 400000;

const OPENAI_TIMEOUT_MS = 45000;
const OPENAI_MAX_RETRIES = 2;

const OPENAI_IMAGE_TIMEOUT_MS = 60000;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function redactSecrets(input: string): string {
  return String(input || '')
    // OpenAI keys
    .replace(/sk-[A-Za-z0-9_\-]{16,}/g, '[REDACTED]');
}

function summarizeOpenAIError(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText || '{}');
    const msg = parsed?.error?.message;
    if (msg) return redactSecrets(String(msg));
  } catch {
    // ignore
  }

  if (status === 401) return "OpenAI authentication failed (server misconfigured).";
  if (status === 403) return "OpenAI access denied (server misconfigured).";
  if (status === 429) return "OpenAI rate limited. Please retry.";
  if (status >= 500) return "OpenAI service error. Please retry.";

  return "OpenAI request failed.";
}

function isLikelyModelError(status: number, bodyText: string): boolean {
  if (!(status === 400 || status === 404)) return false;
  const lower = String(bodyText || '').toLowerCase();
  if (!lower.includes('model')) return false;
  return (
    lower.includes('does not exist') ||
    lower.includes('not found') ||
    lower.includes('unsupported') ||
    lower.includes('invalid') ||
    lower.includes('no such')
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// ========== VENDOR KNOWLEDGE BASE ==========
const VENDOR_KNOWLEDGE: Record<string, { expertise: string; examTips: string; keyAreas: string[] }> = {
  "Cisco": {
    expertise: "You are a Cisco Certified Internetwork Expert (CCIE) with deep knowledge of Cisco networking technologies, IOS commands, routing protocols (OSPF, EIGRP, BGP), switching (VLANs, STP, VTP), security (ASA, Firepower), SD-WAN, ACI, and wireless (WLC). You understand Cisco exam formats and question styles.",
    examTips: "Cisco exams focus heavily on subnetting, protocol behavior, troubleshooting scenarios, and command syntax. Pay attention to administrative distance, metric calculations, and default behaviors.",
    keyAreas: ["Subnetting & VLSM", "Routing Protocol Metrics", "Switching & STP", "ACLs & NAT", "Troubleshooting Commands", "Network Design"]
  },
  "AWS": {
    expertise: "You are an AWS Solutions Architect Professional with expertise in all AWS services including EC2, S3, Lambda, RDS, DynamoDB, VPC, IAM, CloudFormation, EKS, ECS, and the Well-Architected Framework. You understand AWS pricing, security best practices, and architectural patterns.",
    examTips: "AWS exams test scenario-based decision making. Focus on understanding when to use which service, cost optimization, security (least privilege), high availability patterns, and the shared responsibility model.",
    keyAreas: ["Service Selection", "Cost Optimization", "Security & IAM", "High Availability", "Serverless Architecture", "Migration Strategies"]
  },
  "Microsoft": {
    expertise: "You are a Microsoft Certified Solutions Expert with deep knowledge of Azure, Microsoft 365, Windows Server, Active Directory, PowerShell, Intune, Exchange, SharePoint, and Teams. You understand Microsoft's cloud ecosystem and hybrid configurations.",
    examTips: "Microsoft exams include scenario-based questions and may have drag-and-drop or hot area questions. Focus on Azure services, identity management (Azure AD), and hybrid scenarios.",
    keyAreas: ["Azure Services", "Identity & Access", "Microsoft 365 Admin", "PowerShell Automation", "Hybrid Configurations", "Security & Compliance"]
  },
  "Azure": {
    expertise: "You are an Azure Solutions Architect Expert with comprehensive knowledge of Azure compute, storage, networking, identity, security, and DevOps services. You understand ARM templates, Azure CLI, Azure AD, and cloud design patterns.",
    examTips: "Azure exams emphasize practical scenarios, ARM/Bicep templates, cost management, and security. Know the difference between Azure services and when to choose each.",
    keyAreas: ["Compute Options", "Storage Types", "Networking & VNets", "Azure AD & RBAC", "ARM Templates", "Monitoring & Governance"]
  },
  "Google Cloud": {
    expertise: "You are a Google Cloud Professional Architect with expertise in GCP services including Compute Engine, GKE, Cloud Functions, BigQuery, Cloud Storage, IAM, VPC, and Anthos. You understand Google's approach to infrastructure and data analytics.",
    examTips: "GCP exams focus on practical scenarios, BigQuery optimization, Kubernetes, and data processing. Understand IAM roles, service accounts, and Google's security model.",
    keyAreas: ["GKE & Kubernetes", "BigQuery & Analytics", "IAM & Security", "Networking", "Data Processing", "Cost Management"]
  },
  "Penetration Testing": {
    expertise: "You are an experienced penetration tester and ethical hacker with OSCP, CEH, and GPEN certifications. You have deep knowledge of Kali Linux, Metasploit, Burp Suite, Nmap, exploitation techniques, privilege escalation, buffer overflows, web app security (OWASP Top 10), and social engineering.",
    examTips: "Pentesting exams like OSCP are hands-on and require practical skills. Focus on methodology, enumeration, exploitation, post-exploitation, and documentation. Practice in labs extensively.",
    keyAreas: ["Reconnaissance & Enumeration", "Exploitation Techniques", "Privilege Escalation", "Web Application Attacks", "Network Attacks", "Post-Exploitation", "Report Writing"]
  },
  "Offensive Security": {
    expertise: "You are an Offensive Security certified professional (OSCP, OSWE, OSEP) with expertise in penetration testing methodology, Kali Linux, Metasploit Framework, custom exploit development, Active Directory attacks, and advanced evasion techniques.",
    examTips: "Offensive Security exams are 100% practical. You must demonstrate hands-on ability to compromise machines and write professional reports. Time management and methodology are critical.",
    keyAreas: ["PWK Methodology", "Linux Exploitation", "Windows Exploitation", "Active Directory Attacks", "Web App Pentesting", "Exploit Development"]
  },
  "CompTIA": {
    expertise: "You are CompTIA certified across multiple tracks (A+, Network+, Security+, Linux+, Cloud+, PenTest+, CySA+, CASP+). You understand foundational IT concepts, troubleshooting methodology, and vendor-neutral best practices.",
    examTips: "CompTIA exams use performance-based questions (PBQs) and multiple choice. Focus on understanding concepts, troubleshooting steps, and security best practices. Know port numbers and protocols.",
    keyAreas: ["Troubleshooting Methodology", "Network Protocols & Ports", "Security Concepts", "Hardware & Software", "Cloud Concepts", "Risk Management"]
  },
  "Linux": {
    expertise: "You are a Linux Systems Administrator with RHCSA, RHCE, and LPIC certifications. You have deep knowledge of Linux distributions, shell scripting, systemd, package management, networking, security, and containerization.",
    examTips: "Linux certification exams (especially RHCSA/RHCE) are hands-on. You must perform tasks in a live environment. Practice commands, shell scripting, and system administration tasks repeatedly.",
    keyAreas: ["File Systems & Permissions", "User & Group Management", "Systemd & Services", "Networking Configuration", "Shell Scripting", "SELinux & Security", "LVM & Storage"]
  },
  "Kubernetes": {
    expertise: "You are a Certified Kubernetes Administrator (CKA) and Certified Kubernetes Application Developer (CKAD) with expertise in container orchestration, YAML manifests, kubectl, Helm, networking (CNI, Services, Ingress), storage, and security.",
    examTips: "CKA/CKAD exams are hands-on performance-based. Speed and accuracy matter. Know kubectl commands by heart, understand YAML structure, and practice troubleshooting pods and networking.",
    keyAreas: ["Pods & Deployments", "Services & Networking", "Storage & PVs", "ConfigMaps & Secrets", "RBAC & Security", "Troubleshooting", "Helm Charts"]
  },
  "VMware": {
    expertise: "You are a VMware Certified Professional (VCP) with expertise in vSphere, ESXi, vCenter, NSX-T, vSAN, Horizon, and vRealize. You understand virtualization concepts, high availability, DRS, and virtual networking.",
    examTips: "VMware exams require understanding of the entire vSphere stack. Focus on vCenter operations, HA/DRS configurations, networking (vDS, NSX), and storage (VMFS, vSAN). Know the vSphere client well.",
    keyAreas: ["vSphere Architecture", "ESXi & vCenter", "Networking (vDS, NSX)", "Storage (VMFS, vSAN)", "HA & DRS", "Resource Management"]
  },
  "Palo Alto": {
    expertise: "You are a Palo Alto Networks Certified Security Engineer (PCNSE) with expertise in next-generation firewalls, PAN-OS, App-ID, User-ID, Content-ID, WildFire, GlobalProtect VPN, and Prisma Cloud.",
    examTips: "Palo Alto exams focus on firewall configuration, security policies, NAT, VPN, and threat prevention. Understand the packet flow, security profiles, and Panorama management.",
    keyAreas: ["Security Policies", "NAT Configuration", "App-ID & User-ID", "Threat Prevention", "VPN (Site-to-Site, GlobalProtect)", "Panorama Management"]
  },
  "Fortinet": {
    expertise: "You are Fortinet NSE certified with expertise in FortiGate firewalls, FortiOS, FortiManager, FortiAnalyzer, SD-WAN, and the Fortinet Security Fabric. You understand UTM features and network security.",
    examTips: "Fortinet NSE exams cover firewall policies, VPN, SD-WAN, UTM features, and FortiManager. Focus on policy configuration, routing, and the Fortinet Security Fabric integration.",
    keyAreas: ["Firewall Policies", "VPN Configuration", "SD-WAN", "UTM Features", "FortiManager", "High Availability"]
  },
  "Juniper": {
    expertise: "You are Juniper Networks Certified with expertise in Junos OS, SRX firewalls, MX/QFX routers/switches, Contrail, and Apstra. You understand Junos CLI, routing protocols, and network automation.",
    examTips: "Juniper exams focus on Junos CLI commands, configuration hierarchy, and troubleshooting. Understand commit model, routing instances, and security policies.",
    keyAreas: ["Junos CLI", "Routing Protocols", "Switching", "Security Policies", "Routing Instances", "Network Automation"]
  },
  "CISSP": {
    expertise: "You are a CISSP-certified information security professional with expertise across all 8 domains: Security and Risk Management, Asset Security, Security Architecture, Communication and Network Security, IAM, Security Assessment, Security Operations, and Software Development Security.",
    examTips: "CISSP is a management-level exam. Think like a risk advisor, not a technician. Focus on frameworks, policies, and making business-aligned security decisions. Questions often have multiple 'correct' answers - choose the BEST one.",
    keyAreas: ["Risk Management", "Security Governance", "Access Control Models", "Cryptography", "Network Security", "Incident Response", "BCP/DRP", "Software Security"]
  },
  "Project Management": {
    expertise: "You are a PMP-certified project manager with expertise in PMBOK Guide, Agile methodologies, Scrum, project lifecycle, stakeholder management, risk management, and earned value management.",
    examTips: "PMP exam questions are situational. Understand the project manager's role, ITTO (Inputs, Tools, Techniques, Outputs), and process groups. Think about what a PM should do in each scenario.",
    keyAreas: ["Process Groups", "Knowledge Areas", "Agile/Scrum", "Stakeholder Management", "Risk Management", "Schedule & Cost Control", "Quality Management"]
  }
};

// ========== LLM ROUTER (OpenAI primary; optional Gemini fallback) ==========
// This function name is historical. It now routes to the best configured provider
// while keeping the same response shape expected by the mobile app.

type LlmProvider = 'openai' | 'gemini' | 'anthropic';

function normalizeProviderOrder(order: any): LlmProvider[] {
  if (!Array.isArray(order)) return [];
  const normalized: LlmProvider[] = [];
  for (const raw of order) {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'openai' || v === 'gemini' || v === 'anthropic') normalized.push(v);
  }
  // de-dupe while preserving order
  return Array.from(new Set(normalized)) as LlmProvider[];
}

function intersectProviderOrder(order: LlmProvider[], allowed: LlmProvider[]): LlmProvider[] {
  const allowedSet = new Set(allowed);
  return order.filter((p) => allowedSet.has(p));
}

type LlmCallMeta = {
  supabase: any;
  userId: string;
  requestType: string;
  documentId?: string | null;
};

type LlmCallUsage = {
  provider: LlmProvider;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  estimatedCost: number;
  latencyMs: number | null;
  wasFallback: boolean;
};

type LlmInternalResult = { text: string; usage: LlmCallUsage };

function parseOptionalNumberEnv(name: string): number | null {
  const raw = (Deno.env.get(name) || '').trim();
  if (!raw) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function parseOptionalBoolEnv(name: string): boolean {
  const raw = (Deno.env.get(name) || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function sseHeaders() {
  return {
    ...corsHeaders,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  };
}

// ========== CHAT MIND MODE + MEMORY ==========
type ChatMindMode = 'general' | 'study' | 'work' | 'health';

function normalizeChatMindMode(raw: any): ChatMindMode {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'study' || v === 'work' || v === 'health') return v;
  return 'general';
}

function modeGuidance(mode: ChatMindMode): string {
  if (mode === 'study') {
    return `\n\nMode: Study\n- Teach step-by-step when helpful.\n- Use short examples.\n- End with 1 quick check question when appropriate.`;
  }
  if (mode === 'work') {
    return `\n\nMode: Work\n- Be direct and actionable.\n- Prefer bullets, templates, and next steps.\n- Highlight risks and assumptions.`;
  }
  if (mode === 'health') {
    return `\n\nMode: Health\n- Be supportive and practical.\n- Include safety guidance: not a medical professional; encourage seeing a clinician for urgent/serious symptoms.\n- Ask a short clarifying question if needed.`;
  }
  return `\n\nMode: General\n- Be concise and clear by default. Expand if asked.`;
}

async function getChatMindMemorySummary(supabase: any, userId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from('chatmind_memory')
      .select('summary')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return '';
    return String(data?.summary || '').trim();
  } catch {
    return '';
  }
}

async function clearChatMindMemory(supabase: any, userId: string): Promise<void> {
  try {
    await supabase.from('chatmind_memory').delete().eq('user_id', userId);
  } catch {
    // ignore
  }
}

function shouldUpdateChatMindMemory(userMessage: string): boolean {
  const t = String(userMessage || '').toLowerCase();
  if (!t.trim()) return false;
  // Conservative heuristic to avoid extra calls for most messages.
  return (
    t.includes('my name is') ||
    t.includes('call me') ||
    t.includes('i prefer') ||
    t.includes("i'm") ||
    t.includes('i am ') ||
    t.includes('i work') ||
    t.includes('i study') ||
    t.includes('my goal') ||
    t.includes('remember that') ||
    t.includes("don't forget") ||
    t.includes('تذكر') ||
    t.includes('اسمي')
  );
}

async function updateChatMindMemorySummary(params: {
  supabase: any;
  userId: string;
  previousSummary: string;
  userMessage: string;
  assistantMessage: string;
}): Promise<void> {
  const prev = String(params.previousSummary || '').trim();
  const userMsg = String(params.userMessage || '').trim();
  const assistantMsg = String(params.assistantMessage || '').trim();
  if (!userMsg || !assistantMsg) return;

  // Best-effort + cheap: use a fast model if configured.
  const model = (Deno.env.get('OPENAI_MEMORY_MODEL') || Deno.env.get('OPENAI_CHAT_MODEL_FAST') || Deno.env.get('OPENAI_CHAT_MODEL') || 'gpt-5.2').trim();
  const system = `You maintain a short user memory summary for a chat assistant.\n\nRules:\n- ONLY store stable preferences, user identity details they explicitly shared, recurring goals, and important constraints.\n- NEVER store secrets, passwords, API keys, or payment details.\n- Keep it <= 600 characters.\n- Output ONLY the updated summary text (no JSON, no quotes).`;

  const prompt = `Previous memory summary (may be empty):\n${prev || '(empty)'}\n\nNew conversation snippet:\nUser: ${userMsg}\nAssistant: ${assistantMsg.slice(0, 800)}\n\nUpdated memory summary:`;

  try {
    const next = await callOpenAI(
      [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      250,
      0.1,
      model,
    );

    const cleaned = String(next || '').trim().replace(/^"|"$/g, '');
    const clipped = cleaned.slice(0, 600);
    if (!clipped) return;

    await params.supabase
      .from('chatmind_memory')
      .upsert({ user_id: params.userId, summary: clipped }, { onConflict: 'user_id' });
  } catch {
    // ignore
  }
}

type WebSource = { title: string; url: string; snippet?: string };

// Simple in-memory cache (best-effort) to speed up repeated web searches.
const WEB_SEARCH_CACHE = new Map<string, { at: number; results: WebSource[] }>();
const WEB_SEARCH_TTL_MS = 10 * 60 * 1000;

function serperConfigured(): boolean {
  return Boolean((Deno.env.get('SERPER_API_KEY') || '').trim());
}

function tavilyConfigured(): boolean {
  return Boolean((Deno.env.get('TAVILY_API_KEY') || '').trim());
}

async function webSearch(query: string, maxResults = 5): Promise<WebSource[]> {
  const q = String(query || '').trim();
  if (!q) return [];

  const cacheKey = `${q.toLowerCase()}|${Math.max(1, Math.min(Number(maxResults) || 5, 8))}`;
  const cached = WEB_SEARCH_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.at < WEB_SEARCH_TTL_MS) {
    return cached.results;
  }

  const n = Math.max(1, Math.min(Number(maxResults) || 5, 8));

  // Prefer Tavily if configured, else Serper.
  if (tavilyConfigured()) {
    const apiKey = (Deno.env.get('TAVILY_API_KEY') || '').trim();
    const res = await fetchWithTimeout(
      'https://api.tavily.com/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query: q, max_results: n, include_answer: false }),
      },
      20_000,
    );

    if (!res.ok) {
      // Stateless logging: never log upstream bodies (may contain user query/content).
      console.warn('[openai-proxy] Tavily search failed:', res.status);
      return [];
    }

    const data = await res.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const mapped = results
      .map((r: any) => ({
        title: String(r?.title || '').trim(),
        url: String(r?.url || '').trim(),
        snippet: String(r?.content || r?.snippet || '').trim(),
      }))
      .filter((r: any) => r.title && r.url)
      .slice(0, n);

    WEB_SEARCH_CACHE.set(cacheKey, { at: Date.now(), results: mapped });
    return mapped;
  }

  if (serperConfigured()) {
    const apiKey = (Deno.env.get('SERPER_API_KEY') || '').trim();
    const res = await fetchWithTimeout(
      'https://google.serper.dev/search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        body: JSON.stringify({ q, num: n }),
      },
      20_000,
    );

    if (!res.ok) {
      // Stateless logging: never log upstream bodies (may contain user query/content).
      console.warn('[openai-proxy] Serper search failed:', res.status);
      return [];
    }

    const data = await res.json();
    const organic = Array.isArray(data?.organic) ? data.organic : [];
    const mapped = organic
      .map((r: any) => ({
        title: String(r?.title || '').trim(),
        url: String(r?.link || '').trim(),
        snippet: String(r?.snippet || '').trim(),
      }))
      .filter((r: any) => r.title && r.url)
      .slice(0, n);

    WEB_SEARCH_CACHE.set(cacheKey, { at: Date.now(), results: mapped });
    return mapped;
  }

  return [];
}

async function callOpenAIInternalStream(
  messages: any[],
  maxTokens: number,
  temperature: number,
  model: string,
): Promise<Response> {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const safeMaxTokens = Math.max(1, Math.min(maxTokens || 1, 16000));
  const res = await fetchWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: safeMaxTokens, temperature, stream: true }),
    },
    OPENAI_TIMEOUT_MS,
  );

  if (!res.ok) {
    const bodyText = await res.text();
    const safeMsg = summarizeOpenAIError(res.status, bodyText);
    throw new Error(`OpenAI error: ${res.status} ${safeMsg}`);
  }

  return res;
}

function chunkTextSse(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const t = String(text || '');
  const chunkSize = 48;
  let i = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      function push() {
        if (i >= t.length) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }
        const next = t.slice(i, i + chunkSize);
        i += chunkSize;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: next })}\n\n`));
        setTimeout(push, 0);
      }
      push();
    },
  });
}

function normalizeExportKind(raw: string): 'notes' | 'study_guide' | 'flashcards_csv' | 'quiz_json' | 'report' {
  const k = String(raw || '').trim().toLowerCase();
  if (k === 'study_guide' || k === 'studyguide') return 'study_guide';
  if (k === 'flashcards' || k === 'flashcards_csv') return 'flashcards_csv';
  if (k === 'quiz' || k === 'quiz_json') return 'quiz_json';
  if (k === 'report' || k === 'reports' || k.endsWith('_report') || k.endsWith('report')) return 'report';
  return 'notes';
}

async function generateExportContent(params: {
  kind: 'notes' | 'study_guide' | 'flashcards_csv' | 'quiz_json' | 'report';
  message?: string;
  context: string;
  history?: any[];
  agentId?: string;
  meta?: LlmCallMeta;
}): Promise<{ filename: string; mimeType: string; content: string }> {
  const kind = params.kind;
  const extraMsg = String(params.message || '').trim();
  const ctx = String(params.context || '').slice(0, 18000);
  const history = Array.isArray(params.history) ? params.history.slice(-8) : [];

  const system =
    'You are an expert study assistant. Produce outputs that are accurate and grounded ONLY in the provided document context. ' +
    'If info is missing, say it is not found in the document.';

  if (kind === 'flashcards_csv') {
    const user =
      `Create flashcards as CSV with header: front,back\n` +
      `Rules: 25-60 rows max, no quotes unless needed, no extra commentary.\n` +
      (extraMsg ? `User request: ${extraMsg}\n` : '') +
      `DOCUMENT CONTEXT:\n${ctx}`;
    const text = await callOpenAI([
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: user },
    ], 1800, 0.2, undefined, params.meta);
    return { filename: 'flashcards.csv', mimeType: 'text/csv', content: String(text || '').trim() };
  }

  if (kind === 'quiz_json') {
    const user =
      `Create a quiz JSON array. Output ONLY valid JSON.\n` +
      `Schema: [{"question": string, "choices": string[4], "answerIndex": 0|1|2|3, "explanation": string}]\n` +
      `Rules: 10-20 questions, exam-style, grounded in context.\n` +
      (extraMsg ? `User request: ${extraMsg}\n` : '') +
      `DOCUMENT CONTEXT:\n${ctx}`;
    const raw = await callOpenAI([
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: user },
    ], 2200, 0.2, undefined, params.meta);

    // Ensure valid JSON (best-effort).
    let jsonText = String(raw || '').trim();
    const match = jsonText.match(/\[[\s\S]*\]/);
    if (match) jsonText = match[0];
    try {
      JSON.parse(jsonText);
    } catch {
      // If invalid, wrap as a single-question fallback.
      jsonText = JSON.stringify([
        {
          question: 'Quiz generation failed to produce valid JSON.',
          choices: ['Try again', 'Try again', 'Try again', 'Try again'],
          answerIndex: 0,
          explanation: 'The model output was not valid JSON.',
        },
      ]);
    }
    return { filename: 'quiz.json', mimeType: 'application/json', content: jsonText };
  }

  if (kind === 'study_guide') {
    const user =
      `Create a detailed study guide in Markdown.\n` +
      `Include: title, table of contents, sections with headings, bullets, examples if present, and a short practice checklist.\n` +
      (extraMsg ? `User request: ${extraMsg}\n` : '') +
      `DOCUMENT CONTEXT:\n${ctx}`;
    const text = await callOpenAI([
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: user },
    ], 3200, 0.25, undefined, params.meta);
    return { filename: 'study_guide.md', mimeType: 'text/markdown', content: String(text || '').trim() };
  }

  if (kind === 'report') {
    const user =
      `Create a professional report in Markdown.\n` +
      `Include: Title, Executive Summary, Background, Methodology, Findings, Analysis, Recommendations, Risks/Limitations, Conclusion, Appendix (if relevant).\n` +
      `Use clean headings, bullets, and concise paragraphs. Be formal and modern.\n` +
      (extraMsg ? `Report focus/type: ${extraMsg}\n` : '') +
      `DOCUMENT CONTEXT:\n${ctx}`;
    const text = await callOpenAI([
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: user },
    ], 3600, 0.25, undefined, params.meta);
    return { filename: 'report.md', mimeType: 'text/markdown', content: String(text || '').trim() };
  }

  // notes
  {
    const user =
      `Create clean study notes in Markdown.\n` +
      `Format: headings + bullets, concise, no filler.\n` +
      (extraMsg ? `User request: ${extraMsg}\n` : '') +
      `DOCUMENT CONTEXT:\n${ctx}`;
    const text = await callOpenAI([
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: user },
    ], 2200, 0.2, undefined, params.meta);
    return { filename: 'notes.md', mimeType: 'text/markdown', content: String(text || '').trim() };
  }
}

function shouldUseWebSearchForChat(question: string): boolean {
  // Only if enabled and we have a search provider key.
  const enabled = parseOptionalBoolEnv('CHAT_ENABLE_WEB_SEARCH');
  if (!enabled) return false;
  if (!tavilyConfigured() && !serperConfigured()) return false;

  const q = String(question || '').toLowerCase();
  if (!q.trim()) return false;

  // Chat Mind behavior: if web search is enabled, always attempt it.
  // This keeps output consistently "ChatGPT-like" with citations.
  return true;
}

function formatSourcesForPrompt(sources: WebSource[]): string {
  const lines: string[] = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    lines.push(`[${i + 1}] ${s.title}\n${s.url}${s.snippet ? `\n${s.snippet}` : ''}`);
  }
  return lines.join('\n\n');
}

function formatSourcesForResponse(sources: WebSource[]): string {
  const lines: string[] = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    lines.push(`[${i + 1}] ${s.title} — ${s.url}`);
  }
  return lines.join('\n');
}

function detectLanguageFromText(text: string): string {
  const t = String(text || '');
  if (!t.trim()) return 'en';

  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(t)) return 'ar';
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(t)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(t)) return 'ko';
  if (/[\u4E00-\u9FFF]/.test(t)) return 'zh';
  if (/[\u0400-\u04FF]/.test(t)) return 'ru';

  const lower = t.toLowerCase();
  if (/[¿¡]/.test(t) || /\b(que|para|con|por|como|pero|porque|gracias|hola|usted|ustedes)\b/.test(lower)) return 'es';
  if (/\b(le|la|les|des|pour|avec|merci|bonjour|vous|au|aux)\b/.test(lower)) return 'fr';
  if (/\b(der|die|das|und|nicht|bitte|danke|haben|sein)\b/.test(lower)) return 'de';
  if (/\b(não|voce|você|para|com|obrigado|obrigada|ola|olá)\b/.test(lower)) return 'pt';
  if (/\b(che|per|con|grazie|ciao|voi|sei|una|uno)\b/.test(lower)) return 'it';

  return 'en';
}

function languageInstruction(lang: string): string {
  switch (lang) {
    case 'ar': return '\nLanguage: Respond in Arabic.';
    case 'zh': return '\nLanguage: Respond in Chinese.';
    case 'ja': return '\nLanguage: Respond in Japanese.';
    case 'ko': return '\nLanguage: Respond in Korean.';
    case 'ru': return '\nLanguage: Respond in Russian.';
    case 'es': return '\nLanguage: Respond in Spanish.';
    case 'fr': return '\nLanguage: Respond in French.';
    case 'de': return '\nLanguage: Respond in German.';
    case 'pt': return '\nLanguage: Respond in Portuguese.';
    case 'it': return '\nLanguage: Respond in Italian.';
    default: return '';
  }
}

function estimateCostFromEnv(tokensInput: number, tokensOutput: number): number {
  // Optional: set these env vars if you want cost estimation in DB.
  // Example values are provider/model-specific; do not hardcode them here.
  const inPer1k = parseOptionalNumberEnv('AI_COST_INPUT_PER_1K_TOKENS');
  const outPer1k = parseOptionalNumberEnv('AI_COST_OUTPUT_PER_1K_TOKENS');
  if (!inPer1k && !outPer1k) return 0;
  const inCost = inPer1k ? (tokensInput / 1000) * inPer1k : 0;
  const outCost = outPer1k ? (tokensOutput / 1000) * outPer1k : 0;
  const cost = inCost + outCost;
  return Number.isFinite(cost) ? cost : 0;
}

async function tryLogAiUsage(meta: LlmCallMeta | undefined, usage: LlmCallUsage, success: boolean, errorMessage?: string) {
  if (!meta?.supabase || !meta?.userId) return;
  try {
    await meta.supabase.rpc('log_ai_usage', {
      p_user_id: meta.userId,
      p_provider: usage.provider,
      p_model: usage.model,
      p_tokens_input: usage.tokensInput || 0,
      p_tokens_output: usage.tokensOutput || 0,
      p_estimated_cost: usage.estimatedCost || 0,
      p_request_type: meta.requestType,
      p_document_id: meta.documentId || null,
      p_success: Boolean(success),
      p_error_message: success ? null : String(errorMessage || 'unknown error').slice(0, 500),
      p_latency_ms: usage.latencyMs ?? null,
      p_was_fallback: Boolean(usage.wasFallback),
    });
  } catch (e: any) {
    console.warn('[openai-proxy] Failed to log_ai_usage:', String(e?.message || e).slice(0, 200));
  }
}

// Lightweight burst limiter (best-effort, per edge instance).
const burstLimiterState: Map<string, number[]> = new Map();
const guestDailyUsage: Map<string, { date: string; count: number }> = new Map();

function checkBurstLimit(userId: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const limit = parseOptionalNumberEnv('AI_BURST_REQUESTS_PER_MINUTE');
  if (!limit || limit <= 0) return { ok: true };

  const now = Date.now();
  const windowMs = 60_000;
  const timestamps = burstLimiterState.get(userId) || [];
  const pruned = timestamps.filter((t) => now - t < windowMs);

  if (pruned.length >= limit) {
    const oldest = pruned[0];
    const retryAfterMs = Math.max(0, windowMs - (now - oldest));
    burstLimiterState.set(userId, pruned);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  pruned.push(now);
  burstLimiterState.set(userId, pruned);
  return { ok: true };
}

function checkGuestDailyLimit(guestKey: string, limit: number): { ok: true } | { ok: false } {
  if (!limit || limit <= 0) return { ok: true };
  const today = new Date().toISOString().slice(0, 10);
  const existing = guestDailyUsage.get(guestKey);
  if (!existing || existing.date !== today) {
    guestDailyUsage.set(guestKey, { date: today, count: 1 });
    return { ok: true };
  }
  if (existing.count >= limit) return { ok: false };
  existing.count += 1;
  guestDailyUsage.set(guestKey, existing);
  return { ok: true };
}

function parseProviderOrder(): LlmProvider[] {
  const raw = (Deno.env.get('LLM_PROVIDER_ORDER') || 'openai').trim();
  const parts = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const allowed: LlmProvider[] = [];
  for (const p of parts) {
    if (p === 'openai' || p === 'gemini' || p === 'anthropic') allowed.push(p as LlmProvider);
  }
  return allowed.length ? allowed : ['openai'];
}

function openAiConfigured(): boolean {
  return Boolean(Deno.env.get('OPENAI_API_KEY'));
}

function geminiConfigured(): boolean {
  return Boolean(Deno.env.get('GEMINI_API_KEY'));
}

async function isPremiumUser(supabase: any, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('is_active,tier,expires_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) return false;
    const isActive = Boolean((data as any).is_active);
    const tier = String((data as any).tier || 'free');
    const expiresAt = (data as any).expires_at ? new Date((data as any).expires_at) : null;
    const notExpired = !expiresAt || expiresAt.getTime() > Date.now();
    return isActive && notExpired && (tier === 'pro' || tier === 'enterprise');
  } catch {
    return false;
  }
}

function anthropicConfigured(): boolean {
  return Boolean(Deno.env.get('ANTHROPIC_API_KEY'));
}

function summarizeAnthropicError(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText || '{}');
    const msg = parsed?.error?.message || parsed?.message;
    if (msg) return redactSecrets(String(msg));
  } catch {
    // ignore
  }
  if (status === 401) return 'Anthropic authentication failed (server misconfigured).';
  if (status === 403) return 'Anthropic access denied (server misconfigured).';
  if (status === 429) return 'Anthropic rate limited. Please retry.';
  if (status >= 500) return 'Anthropic service error. Please retry.';
  return 'Anthropic request failed.';
}

function openAiMessagesToAnthropic(messages: any[]): { system: string; messages: any[] } {
  const sys: string[] = [];
  const out: any[] = [];

  for (const m of (messages || [])) {
    const role = String(m?.role || 'user').trim().toLowerCase();
    const content = (typeof m?.content === 'string') ? m.content : JSON.stringify(m?.content ?? '');
    if (role === 'system') {
      sys.push(content);
      continue;
    }
    // Anthropic messages support only user/assistant roles
    out.push({ role: role === 'assistant' ? 'assistant' : 'user', content: [{ type: 'text', text: content }] });
  }

  return { system: sys.join('\n\n').trim(), messages: out };
}

async function callAnthropicInternal(
  messages: any[],
  maxTokens: number,
  temperature: number,
  model: string,
): Promise<LlmInternalResult> {
  const apiKey = (Deno.env.get('ANTHROPIC_API_KEY') || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const startedAt = Date.now();
  const safeMaxTokens = Math.max(1, Math.min(maxTokens || 1, 8000));
  const modelToUse = model || Deno.env.get('ANTHROPIC_TEXT_MODEL') || 'claude-3-5-sonnet-latest';
  const { system, messages: anthMessages } = openAiMessagesToAnthropic(messages);

  let lastErr: any;
  for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: modelToUse,
            max_tokens: safeMaxTokens,
            temperature,
            system: system || undefined,
            messages: anthMessages,
          }),
        },
        OPENAI_TIMEOUT_MS,
      );

      if (!res.ok) {
        const bodyText = await res.text();
        const safeMsg = summarizeAnthropicError(res.status, bodyText);
        const err: any = new Error(`Anthropic error: ${res.status} ${safeMsg}`);
        err.status = res.status;
        // Stateless logging: never log upstream bodies (may contain user content).
        console.error('[openai-proxy] Anthropic error:', res.status);
        if ((res.status === 429 || res.status >= 500) && attempt < OPENAI_MAX_RETRIES) {
          await sleep(500 * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }

      const data = await res.json();
      const blocks = Array.isArray(data?.content) ? data.content : [];
      const text = blocks
        .filter((b: any) => b?.type === 'text')
        .map((b: any) => String(b?.text || ''))
        .join('')
        .trim();

      const inTok = Number(data?.usage?.input_tokens) || 0;
      const outTok = Number(data?.usage?.output_tokens) || 0;

      return {
        text,
        usage: {
          provider: 'anthropic',
          model: String(modelToUse),
          tokensInput: inTok,
          tokensOutput: outTok,
          estimatedCost: estimateCostFromEnv(inTok, outTok),
          latencyMs: Date.now() - startedAt,
          wasFallback: false,
        },
      };
    } catch (e: any) {
      lastErr = e;
      const msg = (e?.message || '').toLowerCase();
      const isTimeout = msg.includes('aborted') || msg.includes('timeout');
      if ((isTimeout || e?.status === 429 || e?.status >= 500) && attempt < OPENAI_MAX_RETRIES) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      break;
    }
  }

  throw lastErr || new Error('Anthropic request failed');
}

function summarizeGeminiError(status: number, bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText || '{}');
    const msg = parsed?.error?.message || parsed?.message;
    if (msg) return redactSecrets(String(msg));
  } catch {
    // ignore
  }
  if (status === 401) return 'Gemini authentication failed (server misconfigured).';
  if (status === 403) return 'Gemini access denied (server misconfigured).';
  if (status === 429) return 'Gemini rate limited. Please retry.';
  if (status >= 500) return 'Gemini service error. Please retry.';
  return 'Gemini request failed.';
}

function openAiMessagesToGeminiText(messages: any[]): string {
  // Minimal, robust conversion that preserves role context.
  // Gemini supports multi-turn, but we keep it simple and stable.
  return (messages || []).map((m: any) => {
    const role = String(m?.role || 'user').toUpperCase();
    const content = (typeof m?.content === 'string') ? m.content : JSON.stringify(m?.content ?? '');
    return `${role}: ${content}`;
  }).join('\n\n');
}

async function callOpenAIInternal(
  messages: any[],
  maxTokens: number,
  temperature: number,
  model: string,
): Promise<LlmInternalResult> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const safeMaxTokens = Math.max(1, Math.min(maxTokens || 1, 16000));

  const fallbackModel = Deno.env.get('OPENAI_FALLBACK_MODEL') || 'gpt-4o-mini';
  let modelToUse = model;
  let usedFallback = false;

  let lastErr: any;
  for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt++) {
    try {
      const startedAt = Date.now();
      const res = await fetchWithTimeout(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body: JSON.stringify({ model: modelToUse, messages, max_tokens: safeMaxTokens, temperature }),
        },
        OPENAI_TIMEOUT_MS
      );

      if (!res.ok) {
        const bodyText = await res.text();
        const safeMsg = summarizeOpenAIError(res.status, bodyText);

        // If the requested model isn't available, retry once with a safe fallback model.
        if (!usedFallback && fallbackModel && modelToUse !== fallbackModel && isLikelyModelError(res.status, bodyText)) {
          console.warn(`[openai-proxy] Model not available (${modelToUse}). Falling back to ${fallbackModel}.`);
          modelToUse = fallbackModel;
          usedFallback = true;
          continue;
        }

        const err: any = new Error(`OpenAI error: ${res.status} ${safeMsg}`);
        err.status = res.status;
        // Stateless logging: never log upstream bodies (may contain user content).
        console.error('[openai-proxy] OpenAI error:', res.status);
        // Retry on rate limits / transient errors
        if ((res.status === 429 || res.status >= 500) && attempt < OPENAI_MAX_RETRIES) {
          await sleep(500 * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || "";

      const tokensInput = Number(data?.usage?.prompt_tokens || 0);
      const tokensOutput = Number(data?.usage?.completion_tokens || 0);
      const usedModel = String(data?.model || modelToUse);
      const latencyMs = Date.now() - startedAt;

      return {
        text,
        usage: {
          provider: 'openai',
          model: usedModel,
          tokensInput: Number.isFinite(tokensInput) ? tokensInput : 0,
          tokensOutput: Number.isFinite(tokensOutput) ? tokensOutput : 0,
          estimatedCost: estimateCostFromEnv(tokensInput, tokensOutput),
          latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
          wasFallback: Boolean(usedFallback),
        },
      };
    } catch (e: any) {
      lastErr = e;
      const msg = (e?.message || '').toLowerCase();
      const isTimeout = msg.includes('aborted') || msg.includes('timeout');
      if (isTimeout && attempt < OPENAI_MAX_RETRIES) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      break;
    }
  }

  throw lastErr || new Error('OpenAI request failed');
}

async function callGeminiInternal(
  messages: any[],
  maxTokens: number,
  temperature: number,
  model: string,
): Promise<LlmInternalResult> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const safeMaxTokens = Math.max(1, Math.min(maxTokens || 1, 8192));
  const promptText = openAiMessagesToGeminiText(messages);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let lastErr: any;
  for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt++) {
    try {
      const startedAt = Date.now();
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: promptText }] }],
            generationConfig: {
              temperature,
              maxOutputTokens: safeMaxTokens,
            },
          }),
        },
        OPENAI_TIMEOUT_MS
      );

      if (!res.ok) {
        const bodyText = await res.text();
        const safeMsg = summarizeGeminiError(res.status, bodyText);
        const err: any = new Error(`Gemini error: ${res.status} ${safeMsg}`);
        err.status = res.status;
        // Stateless logging: never log upstream bodies (may contain user content).
        console.error('[openai-proxy] Gemini error:', res.status);
        if ((res.status === 429 || res.status >= 500) && attempt < OPENAI_MAX_RETRIES) {
          await sleep(500 * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) {
        const text = parts.map((p: any) => p?.text).filter(Boolean).join('');
        return {
          text: text || '',
          usage: {
            provider: 'gemini',
            model: String(model || ''),
            tokensInput: 0,
            tokensOutput: 0,
            estimatedCost: 0,
            latencyMs: Date.now() - startedAt,
            wasFallback: false,
          },
        };
      }
      return {
        text: '',
        usage: {
          provider: 'gemini',
          model: String(model || ''),
          tokensInput: 0,
          tokensOutput: 0,
          estimatedCost: 0,
          latencyMs: Date.now() - startedAt,
          wasFallback: false,
        },
      };
    } catch (e: any) {
      lastErr = e;
      const msg = (e?.message || '').toLowerCase();
      const isTimeout = msg.includes('aborted') || msg.includes('timeout');
      if (isTimeout && attempt < OPENAI_MAX_RETRIES) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      break;
    }
  }

  throw lastErr || new Error('Gemini request failed');
}

async function callOpenAI(
  messages: any[],
  maxTokens = 16000,
  temperature = 0.3,
  model?: string,
  meta?: LlmCallMeta,
  providersOverride?: LlmProvider[],
  modelOverrides?: Partial<Record<LlmProvider, string>>,
): Promise<string> {
  // Prefer the same model as chat (OPENAI_CHAT_MODEL) when no explicit model is provided.
  // This avoids breaking non-chat endpoints when PRIMARY_TEXT_MODEL is unset or uses an unavailable model.
  const desiredModel = String(
    modelOverrides?.openai ||
      model ||
      Deno.env.get('PRIMARY_TEXT_MODEL') ||
      Deno.env.get('OPENAI_CHAT_MODEL') ||
      'gpt-4o'
  );
  const configuredOrder = normalizeProviderOrder(parseProviderOrder());
  const overrideOrder = normalizeProviderOrder(providersOverride);
  const providers = overrideOrder.length > 0
    ? intersectProviderOrder(overrideOrder, configuredOrder)
    : configuredOrder;

  let lastErr: any;
  for (let idx = 0; idx < providers.length; idx++) {
    const provider = providers[idx];
    try {
      if (provider === 'openai') {
        if (!openAiConfigured()) throw new Error('OPENAI_API_KEY not set');
        const res = await callOpenAIInternal(messages, maxTokens, temperature, desiredModel);
        await tryLogAiUsage(meta, { ...res.usage, wasFallback: res.usage.wasFallback || idx > 0 }, true);
        return res.text;
      }
      if (provider === 'gemini') {
        if (!geminiConfigured()) throw new Error('GEMINI_API_KEY not set');
        const geminiModel = String(modelOverrides?.gemini || Deno.env.get('GEMINI_TEXT_MODEL') || desiredModel);
        const res = await callGeminiInternal(messages, maxTokens, temperature, geminiModel);
        await tryLogAiUsage(meta, { ...res.usage, model: geminiModel, wasFallback: idx > 0 }, true);
        return res.text;
      }
      if (provider === 'anthropic') {
        if (!anthropicConfigured()) throw new Error('ANTHROPIC_API_KEY not set');
        const anthropicModel = String(modelOverrides?.anthropic || Deno.env.get('ANTHROPIC_TEXT_MODEL') || 'claude-3-5-sonnet-latest');
        const res = await callAnthropicInternal(messages, maxTokens, temperature, anthropicModel);
        await tryLogAiUsage(meta, { ...res.usage, model: anthropicModel, wasFallback: idx > 0 }, true);
        return res.text;
      }
    } catch (e: any) {
      lastErr = e;
      console.warn(`[openai-proxy] Provider ${provider} failed: ${String(e?.message || e).slice(0, 200)}`);
      continue;
    }
  }

  await tryLogAiUsage(
    meta,
    {
      provider: 'openai',
      model: desiredModel,
      tokensInput: 0,
      tokensOutput: 0,
      estimatedCost: 0,
      latencyMs: null,
      wasFallback: true,
    },
    false,
    String(lastErr?.message || lastErr || 'No LLM provider configured'),
  );

  throw lastErr || new Error('No LLM provider configured');
}

function chooseChatProviderOrder(params: { question: string; context: string; history?: any[] }): LlmProvider[] {
  // Preserve admin-configured provider list; only reorder.
  const configuredOrder = normalizeProviderOrder(parseProviderOrder());
  if (configuredOrder.length <= 1) return configuredOrder;

  const q = String(params?.question || '').toLowerCase();
  const context = String(params?.context || '');
  const ctxLen = context.length;

  const hasCodeSignals =
    q.includes('```') ||
    q.includes('stack trace') ||
    q.includes('exception') ||
    q.includes('traceback') ||
    q.includes('typescript') ||
    q.includes('javascript') ||
    q.includes('react') ||
    q.includes('swift') ||
    q.includes('kotlin') ||
    q.includes('python') ||
    q.includes('sql') ||
    q.includes('bug') ||
    q.includes('error');

  const wantsSummarizeOrExtract =
    q.includes('summarize') ||
    q.includes('summary') ||
    q.includes('tl;dr') ||
    q.includes('extract') ||
    q.includes('key points') ||
    q.includes('main points') ||
    q.includes('outline');

  const wantsTranslate = q.includes('translate') || q.includes('ترجم') || q.includes('ترجمة');

  // Heuristics:
  // - Long-context summarization/translation tends to do well on Gemini.
  // - Code/debugging tends to do well on OpenAI.
  // - Otherwise: prefer OpenAI, then Claude, then Gemini (if configured).
  if ((ctxLen > 12000 && wantsSummarizeOrExtract) || (ctxLen > 8000 && wantsTranslate)) {
    return intersectProviderOrder(['gemini', 'anthropic', 'openai'], configuredOrder);
  }
  if (hasCodeSignals) {
    return intersectProviderOrder(['openai', 'anthropic', 'gemini'], configuredOrder);
  }

  return intersectProviderOrder(['openai', 'anthropic', 'gemini'], configuredOrder);
}

// Strict JSON helper: asks the best configured provider to return a single JSON object.
async function callOpenAIJson(
  messages: any[],
  maxTokens = 4096,
  temperature = 0.2,
  model?: string,
): Promise<any> {
    // Prefer the same model as chat (OPENAI_CHAT_MODEL) when no explicit JSON model is set.
    // Many projects configure chat only; using gpt-4o defaults can break quiz/studyPlan if unavailable.
    const desiredModel =
      model ||
      Deno.env.get('PRIMARY_JSON_MODEL') ||
      Deno.env.get('PRIMARY_TEXT_MODEL') ||
      Deno.env.get('OPENAI_CHAT_MODEL') ||
      'gpt-4o';
    const providers = parseProviderOrder();

    // Helper that keeps the old OpenAI strict-JSON behavior.
    async function callOpenAIJsonInternal(modelToUse: string): Promise<any> {
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) throw new Error("OPENAI_API_KEY not set");

      const safeMaxTokens = Math.max(1, Math.min(maxTokens || 1, 8000));

      const fallbackModel =
        Deno.env.get('OPENAI_FALLBACK_MODEL') ||
        Deno.env.get('OPENAI_CHAT_MODEL') ||
        'gpt-4o-mini';
      let usedModel = modelToUse;
      let usedFallback = false;

      let lastErr: any;
      for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt++) {
        try {
          const res = await fetchWithTimeout(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: usedModel,
                messages,
                max_tokens: safeMaxTokens,
                temperature,
                response_format: { type: "json_object" },
              }),
            },
            OPENAI_TIMEOUT_MS
          );

          if (!res.ok) {
            const bodyText = await res.text();
            const safeMsg = summarizeOpenAIError(res.status, bodyText);

            if (!usedFallback && fallbackModel && usedModel !== fallbackModel && isLikelyModelError(res.status, bodyText)) {
              console.warn(`[openai-proxy] Model not available (${usedModel}). Falling back to ${fallbackModel}.`);
              usedModel = fallbackModel;
              usedFallback = true;
              continue;
            }

            const err: any = new Error(`OpenAI error: ${res.status} ${safeMsg}`);
            err.status = res.status;
            // Stateless logging: never log upstream bodies (may contain user content).
            console.error('[openai-proxy] OpenAI error:', res.status);
            if ((res.status === 429 || res.status >= 500) && attempt < OPENAI_MAX_RETRIES) {
              await sleep(500 * Math.pow(2, attempt));
              continue;
            }
            throw err;
          }

          const data = await res.json();
          const text = data.choices?.[0]?.message?.content || "";
          try {
            return JSON.parse(text);
          } catch {
            const err: any = new Error('Model returned invalid JSON');
            err.status = 502;
            throw err;
          }
        } catch (e: any) {
          lastErr = e;
          const msg = (e?.message || '').toLowerCase();
          const isTimeout = msg.includes('aborted') || msg.includes('timeout');
          if (isTimeout && attempt < OPENAI_MAX_RETRIES) {
            await sleep(500 * Math.pow(2, attempt));
            continue;
          }
          break;
        }
      }

      throw lastErr || new Error('OpenAI request failed');
    }

    async function callGeminiJsonInternal(): Promise<any> {
      const geminiModel = Deno.env.get('GEMINI_JSON_MODEL') || Deno.env.get('GEMINI_TEXT_MODEL') || desiredModel;
      // Force a JSON-only response via instruction, then best-effort parse.
      const jsonGuard = { role: 'system', content: 'Return ONLY a single valid JSON object. Do not wrap in markdown. Do not add commentary.' };
      const { text } = await callGeminiInternal([jsonGuard, ...(messages || [])], maxTokens, temperature, geminiModel);

      // Best-effort JSON extraction.
      const raw = String(text || '').trim();
      const match = raw.match(/\{[\s\S]*\}/);
      const jsonText = match ? match[0] : raw;
      try {
        return JSON.parse(jsonText);
      } catch {
        const err: any = new Error('Model returned invalid JSON');
        err.status = 502;
        throw err;
      }
    }

    let lastErr: any;
    for (const provider of providers) {
      try {
        if (provider === 'openai') {
          if (!openAiConfigured()) throw new Error('OPENAI_API_KEY not set');
          return await callOpenAIJsonInternal(desiredModel);
        }
        if (provider === 'gemini') {
          if (!geminiConfigured()) throw new Error('GEMINI_API_KEY not set');
          return await callGeminiJsonInternal();
        }
      } catch (e: any) {
        lastErr = e;
        console.warn(`[openai-proxy] Provider ${provider} JSON failed: ${String(e?.message || e).slice(0, 200)}`);
        continue;
      }
    }

    throw lastErr || new Error('No LLM provider configured');
}

// OpenAI Image helper: returns a data URL (data:image/png;base64,...)
async function callOpenAIImageDataUrl(prompt: string, preferredModel: 'dall-e-3' | 'gpt-image-1'): Promise<string> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  let lastErr: any;
  for (let attempt = 0; attempt <= OPENAI_MAX_RETRIES; attempt++) {
    try {
      let res = await fetchWithTimeout(
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: preferredModel,
            prompt,
            size: "1024x1024",
            n: 1,
          }),
        },
        OPENAI_IMAGE_TIMEOUT_MS
      );

      // Some OpenAI accounts/keys may not have access to a given image model.
      // Fall back to DALL·E 3 for access issues.
      if (res.status === 403 || res.status === 404) {
        res = await fetchWithTimeout(
          "https://api.openai.com/v1/images/generations",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: "dall-e-3",
              prompt,
              size: "1024x1024",
              n: 1,
            }),
          },
          OPENAI_IMAGE_TIMEOUT_MS
        );
      }

      if (!res.ok) {
        const bodyText = await res.text();
        const safeMsg = summarizeOpenAIError(res.status, bodyText);
        const err: any = new Error(`OpenAI image error: ${res.status} ${safeMsg}`);
        err.status = res.status;
        // Stateless logging: never log upstream bodies (may contain user content).
        console.error('[openai-proxy] OpenAI image error:', res.status);
        if ((res.status === 429 || res.status >= 500) && attempt < OPENAI_MAX_RETRIES) {
          await sleep(500 * Math.pow(2, attempt));
          continue;
        }
        throw err;
      }

      const data = await res.json();

      const first = data?.data?.[0];
      const b64 = first?.b64_json;
      if (b64 && typeof b64 === 'string') {
        return `data:image/png;base64,${b64}`;
      }

      const url = first?.url;
      if (url && typeof url === 'string') {
        const imgRes = await fetchWithTimeout(url, { method: 'GET' }, OPENAI_IMAGE_TIMEOUT_MS);
        if (!imgRes.ok) {
          const bodyText = await imgRes.text();
          const err: any = new Error(`OpenAI image download error: ${imgRes.status} ${summarizeOpenAIError(imgRes.status, bodyText)}`);
          err.status = imgRes.status;
          throw err;
        }
        const buf = await imgRes.arrayBuffer();
        const base64 = arrayBufferToBase64(buf);
        return `data:image/png;base64,${base64}`;
      }

      throw new Error('OPENAI_IMAGE_NO_DATA');
    } catch (e: any) {
      lastErr = e;
      const msg = (e?.message || '').toLowerCase();
      const isTimeout = msg.includes('aborted') || msg.includes('timeout');
      if ((isTimeout || e?.status === 429 || e?.status >= 500) && attempt < OPENAI_MAX_RETRIES) {
        await sleep(500 * Math.pow(2, attempt));
        continue;
      }
      break;
    }
  }

  throw lastErr || new Error('OpenAI image request failed');
}

function midjourneyConfigured(): boolean {
  const key = (Deno.env.get('MIDJOURNEY_API_KEY') || '').trim();
  const url = (Deno.env.get('MIDJOURNEY_API_URL') || '').trim();
  return Boolean(key && url);
}

function stabilityConfigured(): boolean {
  const key = (Deno.env.get('STABILITY_API_KEY') || '').trim();
  return Boolean(key);
}

function normalizeImageProviderOrder(order: any): Array<'openai' | 'stability' | 'midjourney'> {
  if (!Array.isArray(order)) return [];
  const normalized: Array<'openai' | 'stability' | 'midjourney'> = [];
  for (const raw of order) {
    const v = String(raw || '').trim().toLowerCase();
    if (v === 'openai' || v === 'stability' || v === 'midjourney') normalized.push(v as any);
  }
  return Array.from(new Set(normalized));
}

function parseImageProviderOrder(): Array<'openai' | 'stability' | 'midjourney'> {
  const raw = (Deno.env.get('IMAGE_PROVIDER_ORDER') || 'openai,stability,midjourney').trim();
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  return normalizeImageProviderOrder(parts);
}

function chooseImageProviderOrder(mode: string): Array<'openai' | 'stability' | 'midjourney'> {
  const configured = parseImageProviderOrder();
  if (configured.length <= 1) return configured;

  if (mode === 'premium') {
    return ['midjourney', 'openai', 'stability'].filter(p => configured.includes(p as any)) as any;
  }
  if (mode === 'realism') {
    return ['openai', 'stability', 'midjourney'].filter(p => configured.includes(p as any)) as any;
  }
  if (mode === 'fast') {
    return ['openai', 'stability', 'midjourney'].filter(p => configured.includes(p as any)) as any;
  }

  return ['openai', 'stability', 'midjourney'].filter(p => configured.includes(p as any)) as any;
}

async function callMidjourneyImageDataUrl(prompt: string): Promise<string> {
  const apiKey = (Deno.env.get('MIDJOURNEY_API_KEY') || '').trim();
  const apiUrl = (Deno.env.get('MIDJOURNEY_API_URL') || '').trim();
  if (!apiKey || !apiUrl) throw new Error('MIDJOURNEY not configured');

  const res = await fetchWithTimeout(
    apiUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ prompt }),
    },
    OPENAI_IMAGE_TIMEOUT_MS
  );

  if (!res.ok) {
    const bodyText = await res.text();
    const err: any = new Error(`Midjourney image error: ${res.status} ${bodyText.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const b64 = data?.b64 || data?.base64 || data?.image_base64;
  if (typeof b64 === 'string' && b64.trim()) {
    return `data:image/png;base64,${b64.trim()}`;
  }

  const url = data?.url || data?.image_url;
  if (typeof url === 'string' && url.trim()) {
    const imgRes = await fetchWithTimeout(url.trim(), { method: 'GET' }, OPENAI_IMAGE_TIMEOUT_MS);
    if (!imgRes.ok) {
      const bodyText = await imgRes.text();
      const err: any = new Error(`Midjourney image download error: ${imgRes.status} ${bodyText.slice(0, 200)}`);
      err.status = imgRes.status;
      throw err;
    }
    const buf = await imgRes.arrayBuffer();
    const base64 = arrayBufferToBase64(buf);
    return `data:image/png;base64,${base64}`;
  }

  throw new Error('MIDJOURNEY_IMAGE_NO_DATA');
}

async function callStabilityImageDataUrl(prompt: string): Promise<string> {
  const apiKey = (Deno.env.get('STABILITY_API_KEY') || '').trim();
  if (!apiKey) throw new Error('STABILITY_API_KEY not set');

  const model = (Deno.env.get('STABILITY_IMAGE_MODEL') || 'stable-diffusion-xl-1024-v1-0').trim();
  const apiUrl = (Deno.env.get('STABILITY_API_URL') || `https://api.stability.ai/v1/generation/${model}/text-to-image`).trim();

  const res = await fetchWithTimeout(
    apiUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        text_prompts: [{ text: prompt }],
        cfg_scale: 7,
        height: 1024,
        width: 1024,
        samples: 1,
        steps: 30,
      }),
    },
    OPENAI_IMAGE_TIMEOUT_MS
  );

  if (!res.ok) {
    const bodyText = await res.text();
    const err: any = new Error(`Stability image error: ${res.status} ${bodyText.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const b64 = data?.artifacts?.[0]?.base64;
  if (typeof b64 === 'string' && b64.trim()) {
    return `data:image/png;base64,${b64.trim()}`;
  }

  throw new Error('STABILITY_IMAGE_NO_DATA');
}

async function generateModuleImageDataUrl(params: { title: string; bullets?: string[]; language?: string }): Promise<string> {
  const title = String(params?.title || 'Study module').slice(0, 140);
  const bullets = Array.isArray(params?.bullets) ? params.bullets.slice(0, 8).map((b) => String(b).trim()).filter(Boolean) : [];

  const focus = bullets.length > 0 ? bullets.join(' | ') : '';
  const prompt = `Create a clean educational illustration representing the topic: "${title}".

Focus concepts (for guidance): ${focus || 'general key concepts'}.

Rules:
- No text, no letters, no words, no numbers.
- No logos, no watermarks.
- Simple, clear visual style suitable for study material.
- High contrast shapes/icons; avoid clutter.
`;

  // Educational illustrations use the realism model by default (best effort).
  return await callOpenAIImageDataUrl(prompt, 'gpt-image-1');
}

async function generateImageDataUrl(prompt: string, imageMode?: string): Promise<string> {
  const p = String(prompt || '').trim();
  if (!p) {
    const err: any = new Error('Missing image prompt. Example: /image a neon brain studying');
    err.status = 400;
    throw err;
  }

  const rawMode = String(imageMode || 'default').trim().toLowerCase();
  const mode =
    rawMode === 'mj' || rawMode === 'midjourney'
      ? 'premium'
      : rawMode === 'nb' || rawMode === 'nano' || rawMode === 'banana'
        ? 'realism'
        : rawMode === 'fast' || rawMode === 'speed'
          ? 'fast'
          : rawMode;

  const clipped = p.slice(0, 1200);
  const enhancedPrompt = `${clipped}\n\nStyle: professional, high-quality, clean lighting, sharp focus, modern, no text, no watermark.`;

  const providers = chooseImageProviderOrder(mode);
  let lastErr: any;

  for (const provider of providers) {
    try {
      if (provider === 'midjourney') {
        if (!midjourneyConfigured()) throw new Error('MIDJOURNEY not configured');
        return await callMidjourneyImageDataUrl(enhancedPrompt);
      }
      if (provider === 'stability') {
        if (!stabilityConfigured()) throw new Error('STABILITY_API_KEY not set');
        return await callStabilityImageDataUrl(enhancedPrompt);
      }
      if (provider === 'openai') {
        const preferredModel =
          mode === 'premium'
            ? 'dall-e-3'
            : mode === 'realism'
              ? 'gpt-image-1'
              : mode === 'fast'
                ? 'gpt-image-1'
                : 'gpt-image-1';
        return await callOpenAIImageDataUrl(enhancedPrompt, preferredModel);
      }
    } catch (e: any) {
      lastErr = e;
      console.warn('[openai-proxy] Image provider failed:', provider, String(e?.message || e).slice(0, 200));
      continue;
    }
  }

  const err: any = lastErr || new Error('No image provider configured');
  err.status = err.status || 503;
  throw err;
}

// ========== AI-BASED VENDOR DETECTION ==========
async function detectVendorAI(content: string, meta?: LlmCallMeta): Promise<{ vendor: string; category: string; certifications: string[]; confidence: string }> {
  const sample = content.slice(0, 15000);
  
  const vendorList = Object.keys(VENDOR_KNOWLEDGE).join(", ");
  
  const prompt = `Analyze this document and identify:
1. The technology vendor or domain. Choose from: ${vendorList}, or other if not in list
2. The category (e.g., Networking, Cloud Computing, Security, Programming, Database, etc.)
3. Any specific certifications mentioned (e.g., CCNA, AWS SAA, OSCP, CISSP, etc.)
4. Confidence level (high, medium, low)

Return ONLY valid JSON:
{"vendor": "...", "category": "...", "certifications": ["..."], "confidence": "high|medium|low"}

Document content:
${sample}`;

  try {
    const result = await callOpenAI([
      { role: "system", content: "You are an expert at identifying IT certifications, vendors, and technical domains. Be precise in vendor identification." },
      { role: "user", content: prompt }
    ], 500, 0.1, undefined, meta);
    
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (e) {
    // Stateless logging: never include document content.
    console.error("Vendor detection error:", String((e as any)?.message || e).slice(0, 200));
  }
  
  return { vendor: "General", category: "Technical Document", certifications: [], confidence: "low" };
}

// ========== GET VENDOR EXPERTISE ==========
function getVendorExpertise(vendor: string): { expertise: string; examTips: string; keyAreas: string[] } | null {
  // Try exact match first
  if (VENDOR_KNOWLEDGE[vendor]) return VENDOR_KNOWLEDGE[vendor];
  
  // Try partial match
  const vendorLower = vendor.toLowerCase();
  for (const [key, value] of Object.entries(VENDOR_KNOWLEDGE)) {
    if (key.toLowerCase().includes(vendorLower) || vendorLower.includes(key.toLowerCase())) {
      return value;
    }
  }
  
  return null;
}

// ========== RICH SUMMARIZE ==========
async function summarize(content: string, language = "en", meta?: LlmCallMeta): Promise<string> {
  const truncated = content.slice(0, MAX_CONTENT_LENGTH);
  
  // First, detect vendor using AI
  const vendorInfo = await detectVendorAI(truncated, meta);
  const vendorExpertise = getVendorExpertise(vendorInfo.vendor);
  
  const vendorContext = vendorInfo.vendor !== "General" 
    ? `This is a **${vendorInfo.vendor}** document in the **${vendorInfo.category}** domain.${vendorInfo.certifications.length > 0 ? ` Related certifications: ${vendorInfo.certifications.join(', ')}.` : ''}`
    : `This is a **${vendorInfo.category}** document.`;
  
  const expertiseContext = vendorExpertise 
    ? `\n\n**Key Areas to Focus On:** ${vendorExpertise.keyAreas.join(', ')}\n**Exam Tips:** ${vendorExpertise.examTips}`
    : '';
  
  const langInstr = language !== 'en' ? `\n\n**IMPORTANT: Write the entire response in ${language === 'ar' ? 'Arabic' : language}.**` : '';
  
  const systemPrompt = vendorExpertise 
    ? vendorExpertise.expertise + " Create comprehensive, detailed study guides with proper markdown formatting, tables, and visual organization. Make the content thorough and exam-focused."
    : "You are an expert technical writer and exam preparation specialist. Create comprehensive, detailed study guides with proper markdown formatting, tables, and visual organization.";
  
  const prompt = `${vendorContext}${expertiseContext}

Create a **comprehensive, detailed study guide** that is at least 2000 words. This should be thorough enough to help someone prepare for an exam.

## Required Format:

### 📚 Executive Overview
A detailed introduction explaining what this document covers, its importance, and learning objectives (2-3 paragraphs).

### 🎯 Key Concepts & Topics
For EACH major topic in the document:
- **Topic Name**: Detailed explanation
- Sub-concepts with bullet points
- Technical details and specifications
- Why it matters for the exam

### 📊 Comparison Tables
Create comparison tables where relevant. Example format:
| Feature | Description | Use Case | Exam Tip |
|---------|-------------|----------|----------|
| ... | ... | ... | ... |

### 🔧 Technical Deep Dive
- Detailed technical explanations
- Command examples or code snippets (if applicable)
- Architecture diagrams described in text
- Step-by-step procedures

### 📝 Important Definitions
| Term | Definition | Example |
|------|------------|---------|
| ... | ... | ... |

### ⚠️ Critical Exam Points
- Must-know facts (bullet list)
- Common exam traps to avoid
- Key numbers, limits, or thresholds to memorize

### 💡 Practical Applications
- Real-world scenarios
- Use cases with examples
- Best practices

### 🔗 Relationships & Dependencies  
- How concepts connect to each other
- Prerequisites and dependencies
- Flow diagrams described in text

### ✅ Quick Review Checklist
A checklist of items to review before the exam.

${langInstr}

---

**Document Content:**
${truncated}`;

  return await callOpenAI([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt }
  ], 16000, 0.4, undefined, meta);
}

// ========== MODULE SUMMARIZE (STRICT JSON) ==========
async function summarizeModuleJSON(params: {
  title: string;
  content: string;
  language?: string;
  source?: { pageStart?: number; pageEnd?: number; inputChars?: number };
  meta?: LlmCallMeta;
}): Promise<any> {
  const title = (params.title || '').toString().slice(0, 200);
  const language = params.language || 'en';
  const moduleContent = (params.content || '').toString();

  if (!moduleContent || moduleContent.trim().length < 50) {
    return {
      title,
      moduleId: crypto.randomUUID(),
      confidence: 'LOW',
      content: {
        executiveSummary: [],
        textBlocks: ['Not enough content to summarize for this module.'],
        tables: [],
        diagrams: [],
        equations: [],
        visuals: [],
      },
    };
  }

  // Guardrail: do not silently truncate; force client to chunk modules if too large.
  if (moduleContent.length > MAX_MODULE_CONTENT_LENGTH) {
    const err: any = new Error(`MODULE_TOO_LARGE: ${moduleContent.length} chars (max ${MAX_MODULE_CONTENT_LENGTH}). Split into smaller modules.`);
    err.status = 413;
    throw err;
  }

  const langInstr = language !== 'en'
    ? `Write the entire response in ${language === 'ar' ? 'Arabic' : language}.`
    : 'Write the entire response in English.';

  // Vendor/persona awareness (consistent with summarize/chat).
  const vendorInfo = moduleContent.length > 200
    ? await detectVendorAI(moduleContent.slice(0, 10000), params.meta)
    : { vendor: "General", category: "General" };
  const vendorExpertise = getVendorExpertise(vendorInfo.vendor || 'General');
  const vendorContext = (vendorInfo?.vendor && vendorInfo.vendor !== 'General')
    ? `\nVendor context: ${vendorInfo.vendor} (${vendorInfo.category || 'General'}).`
    : `\nVendor context: General (${vendorInfo.category || 'General'}).`;
  const expertiseContext = vendorExpertise
    ? `\nFocus areas: ${vendorExpertise.keyAreas.join(', ')}\nExam tips: ${vendorExpertise.examTips}`
    : '';

  const system = `${vendorExpertise ? vendorExpertise.expertise + "\n" : ''}You are a careful technical summarizer.
Rules:
- Use ONLY the provided module content. Do NOT invent facts.
- If information is missing, say "Not specified".
- Be explicit when something is inferred.
- Do NOT include document metadata (author names, filenames, timestamps, copyright/footer text).
- Output MUST be valid JSON only (no markdown, no commentary, no code fences).
- Write in a professional, exam-prep tone: crisp, structured, and actionable.
- ${langInstr}${vendorContext}${expertiseContext}`;

  const user = `Summarize this module as a standalone unit.

Module title: ${title}
Source pages: ${params.source?.pageStart ?? null} - ${params.source?.pageEnd ?? null}
Input chars: ${moduleContent.length}

Return STRICT JSON with this schema:
{
  "moduleId": "string",
  "title": "string",
  "confidence": "LOW"|"MEDIUM"|"HIGH",
  "content": {
    "executiveSummary": ["string", ...],
    "textBlocks": ["string", ...],
    "tables": [{"headers": ["string"], "rows": [["string"]]}],
    "diagrams": [{"type": "mermaid", "code": "string"}],
    "equations": ["string", ...],
    "visuals": ["string", ...]
  }
}

Requirements:
- executiveSummary: 6-12 bullets (each bullet must be short, exam-focused, and specific).
- textBlocks: 6-14 short blocks. Prefer: definitions, steps, pitfalls, commands, checks.
- tables: ALWAYS include 1-2 tables derived from the content. If the module has no explicit table/comparison, create a summary table such as:
  - "Concept | Meaning | How to recognize it | Exam tip" OR
  - "Command/Term | Purpose | Key notes".
  Use "Not specified" where needed. Do NOT invent facts.
- diagrams: ALWAYS include at least 1 mermaid diagram derived from the content.
  - If a process/flow exists: use flowchart.
  - Otherwise: create a concept map (graph TD) connecting 6-12 key nodes mentioned in the module.
- equations: include ONLY equations actually present/derivable from the module; otherwise [].
- visuals: include 2-6 short suggestions for visuals to draw (diagrams, checklists, topology sketches) based on what the module discusses. If nothing is clear, use generic-but-safe study visuals like "Topology sketch" or "Checklist", still grounded in the module topic.
- Do NOT include author names, filename, timestamps, page numbers, or copyright lines.

Module content:
${moduleContent}`;

  let parsed: any;
  try {
    parsed = await callOpenAIJson(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      4096,
      0.2,
    );
  } catch (e: any) {
    const fallback = await callOpenAI(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      4096,
      0.2,
      undefined,
      params.meta,
    );
    const match = String(fallback || '').match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        title,
        moduleId: crypto.randomUUID(),
        confidence: 'LOW',
        content: {
          executiveSummary: [],
          textBlocks: [fallback || 'Unable to parse model output as JSON.'],
          tables: [],
          diagrams: [],
          equations: [],
          visuals: [],
        },
      };
    }
    parsed = JSON.parse(match[0]);
  }
  // Ensure basic fields exist
  parsed.moduleId = parsed.moduleId || crypto.randomUUID();
  parsed.title = parsed.title || title;
  parsed.confidence = (parsed.confidence === 'HIGH' || parsed.confidence === 'MEDIUM' || parsed.confidence === 'LOW') ? parsed.confidence : 'MEDIUM';
  parsed.content = parsed.content || {};
  parsed.content.executiveSummary = Array.isArray(parsed.content.executiveSummary) ? parsed.content.executiveSummary : [];
  parsed.content.textBlocks = Array.isArray(parsed.content.textBlocks) ? parsed.content.textBlocks : [];
  parsed.content.tables = Array.isArray(parsed.content.tables) ? parsed.content.tables : [];
  parsed.content.diagrams = Array.isArray(parsed.content.diagrams) ? parsed.content.diagrams : [];
  parsed.content.equations = Array.isArray(parsed.content.equations) ? parsed.content.equations : [];
  parsed.content.visuals = Array.isArray(parsed.content.visuals) ? parsed.content.visuals : [];
  return parsed;
}

// ========== QUIZ GENERATION ==========
async function generateQuiz(
  content: string,
  count = 10,
  difficulty = "medium",
  language = "en",
  focusTopics?: string[],
  meta?: LlmCallMeta,
): Promise<any[]> {
  const truncated = content.slice(0, MAX_CONTENT_LENGTH);
  const vendorInfo = await detectVendorAI(truncated, meta);
  const vendorExpertise = getVendorExpertise(vendorInfo.vendor);
  
  const vendorContext = vendorInfo.vendor !== "General" 
    ? `This is ${vendorInfo.vendor} ${vendorInfo.category} exam material.${vendorInfo.certifications.length > 0 ? ` Target certifications: ${vendorInfo.certifications.join(', ')}.` : ''}`
    : '';
  
  const examStyle = vendorExpertise 
    ? `\n\nExam Style Tips: ${vendorExpertise.examTips}\nFocus Areas: ${vendorExpertise.keyAreas.join(', ')}`
    : '';
  
  const systemPrompt = vendorExpertise
    ? vendorExpertise.expertise + " Generate professional exam questions that match the real certification exam style."
    : "Generate professional exam questions. Return ONLY valid JSON array.";
  
  const focusBlock = (Array.isArray(focusTopics) && focusTopics.length > 0)
    ? `\n\nFOCUS TOPICS (ONLY generate questions from these topics):\n- ${focusTopics.map(t => String(t).trim()).filter(Boolean).slice(0, 20).join('\n- ')}`
    : '';

  const prompt = `${vendorContext}${examStyle}${focusBlock}

Generate ${count} ${difficulty} difficulty multiple-choice questions in professional exam format.

Requirements:
- Questions should test understanding, not just memorization
- Include scenario-based questions where appropriate
- Explanations should be educational and detailed
- Match the style of real certification exams

Return JSON array: [{"question": "...", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "correctAnswer": 0, "explanation": "..."}]

${language !== 'en' ? `Language: ${language === 'ar' ? 'Arabic' : language}` : ''}

Content:
${truncated}`;

  const result = await callOpenAI([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt }
  ], 8000, 0.3, undefined, meta);
  
  try {
    const match = result.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch {
    return [];
  }
}

// ========== STUDY GUIDE ==========
async function generateStudyGuide(content: string, language = "en", meta?: LlmCallMeta): Promise<string> {
  const truncated = content.slice(0, MAX_CONTENT_LENGTH);
  const vendorInfo = await detectVendorAI(truncated, meta);
  const vendorExpertise = getVendorExpertise(vendorInfo.vendor);
  
  const vendorContext = vendorInfo.vendor !== "General"
    ? `for **${vendorInfo.vendor} ${vendorInfo.category}**${vendorInfo.certifications.length > 0 ? ` (${vendorInfo.certifications.join(', ')})` : ''}`
    : '';

  const expertiseContext = vendorExpertise 
    ? `\n\n**Focus Areas:** ${vendorExpertise.keyAreas.join(', ')}\n**Exam Approach:** ${vendorExpertise.examTips}`
    : '';

  const systemPrompt = vendorExpertise
    ? vendorExpertise.expertise + " Create detailed study guides that match real certification exam requirements."
    : "Create detailed study guides with markdown formatting, tables, and organized sections.";

  const prompt = `Create a comprehensive study guide ${vendorContext}:${expertiseContext}

## 📖 Study Guide Structure:

### 1. Overview & Objectives
- What this material covers
- Learning objectives
- Prerequisites

### 2. Topic Breakdown
For each major topic:
| Topic | Key Points | Difficulty | Time to Master |
|-------|------------|------------|----------------|

### 3. Core Concepts (Detailed)
- Each concept explained thoroughly
- Examples and use cases
- Common misconceptions

### 4. Hands-On Practice Areas
- Lab exercises suggestions
- Practice scenarios
- Self-assessment questions

### 5. Exam Strategy
- Topics by weight/importance
- Time management tips
- Question patterns to expect

### 6. Quick Reference
- Commands/syntax cheat sheet (if applicable)
- Key formulas or procedures
- Acronyms and definitions table

${language !== 'en' ? `\n**Write in ${language === 'ar' ? 'Arabic' : language}.**` : ''}

Content:
${truncated}`;

  return await callOpenAI([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt }
  ], 12000, 0.4, undefined, meta);
}

// ========== STUDY PLAN (TABLE) ==========
async function generateStudyPlan(content: string, language = 'en', meta?: LlmCallMeta): Promise<{ topic: string; hours: number }[]> {
  const truncated = (content || '').slice(0, MAX_CONTENT_LENGTH);
  const vendorInfo = truncated.length > 200 ? await detectVendorAI(truncated, meta) : { vendor: 'General', category: 'General' };
  const vendorExpertise = getVendorExpertise(vendorInfo.vendor);

  const systemPrompt = vendorExpertise
    ? `${vendorExpertise.expertise}\nYou are an exam-prep coach. Create a concise study plan table.`
    : 'You are an exam-prep coach. Create a concise study plan table.';

  const langInstr = language !== 'en'
    ? `Write topic names in ${language === 'ar' ? 'Arabic' : language}.`
    : 'Write topic names in English.';

  const prompt = `Create a study plan table for this document.

Requirements:
- Return ONLY valid JSON (no markdown).
- 8 to 16 rows.
- Each row has: topic (short), hours (number between 0.5 and 6).
- Topics must be grounded in the provided content and reflect exam-important areas.
- Total hours should be roughly 10 to 40.

Return JSON with this schema:
{
  "plan": [
    { "topic": "...", "hours": 2.5 },
    { "topic": "...", "hours": 1 }
  ]
}

Context: ${vendorInfo.vendor || 'General'} (${vendorInfo.category || 'General'}).
${vendorExpertise ? `Focus areas: ${vendorExpertise.keyAreas.join(', ')}` : ''}
${langInstr}

Document Content:
${truncated}`;

  const data = await callOpenAIJson(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    2000,
    0.2,
  );

  const plan = Array.isArray((data as any)?.plan) ? (data as any).plan : [];
  return plan
    .map((r: any) => ({ topic: String(r?.topic || '').trim(), hours: Number(r?.hours || 0) }))
    .filter((r: any) => r.topic && Number.isFinite(r.hours) && r.hours > 0);
}

// ========== FLASHCARDS ==========
async function generateFlashcards(content: string, count = 20, language = "en", meta?: LlmCallMeta): Promise<any[]> {
  const truncated = content.slice(0, MAX_CONTENT_LENGTH);
  const vendorInfo = await detectVendorAI(truncated, meta);
  const vendorExpertise = getVendorExpertise(vendorInfo.vendor);
  
  const systemPrompt = vendorExpertise
    ? vendorExpertise.expertise + " Create flashcards that focus on exam-relevant content."
    : "Create educational flashcards. Return ONLY valid JSON array.";
  
  const focusAreas = vendorExpertise 
    ? `\nKey areas to cover: ${vendorExpertise.keyAreas.join(', ')}`
    : '';

  const prompt = `Create ${count} high-quality flashcards${vendorInfo.vendor !== "General" ? ` for ${vendorInfo.vendor} ${vendorInfo.category} exam preparation` : ''}.${focusAreas}

Requirements:
- Mix of definition cards, concept cards, and scenario cards
- Front should be clear and specific
- Back should be concise but complete

Return JSON array: [{"front": "Question or term", "back": "Answer or definition", "category": "concept|definition|scenario"}]

${language !== 'en' ? `Language: ${language === 'ar' ? 'Arabic' : language}` : ''}

Content:
${truncated}`;

  const result = await callOpenAI([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt }
  ], 6000, 0.3, undefined, meta);
  
  try {
    const match = result.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch {
    return [];
  }
}

// ========== CHAT ==========
async function chat(
  content: string,
  question: string,
  history: any[] = [],
  meta?: LlmCallMeta,
  agentId?: string,
  opts?: { chatMindMode?: ChatMindMode; chatMindMemorySummary?: string; chatMindMemoryEnabled?: boolean }
): Promise<string> {
  // Handle undefined content gracefully
  if (!content || typeof content !== 'string') {
    content = '';
  }
  
  // Keep chat fast: avoid extra vendor-detection AI call and keep context small.
  const truncated = content.slice(0, 25000);

  const selectedAgent = typeof agentId === 'string' ? agentId.trim() : '';
  const agentExpertise = selectedAgent ? getVendorExpertise(selectedAgent) : null;

  const systemPrompt = agentExpertise
    ? `${agentExpertise.expertise}
You are the MindSparkle ${selectedAgent} Agent.
Be concise and clear by default. If the user asks for detail, expand.
Use exam tips when helpful. Focus areas: ${agentExpertise.keyAreas.join(', ')}.
If context is missing, ask 1 short clarifying question.
Accuracy first: do not guess. If unsure, say you are not sure and suggest a next step.
Prefer structured answers: short summary, then bullets/steps when useful.`
    : "You are a helpful AI study assistant. Be concise and clear by default. If the user asks for detail, expand. If context is missing, ask 1 short clarifying question. Accuracy first: do not guess. If unsure, say you are not sure and suggest a next step. Prefer structured answers: short summary, then bullets/steps when useful.";

  const isChatMindRequest = String(meta?.requestType || '') === 'chatMind' || String(meta?.requestType || '') === 'chatMindStream';
  const mode = isChatMindRequest ? normalizeChatMindMode(opts?.chatMindMode) : 'general';
  const memorySummary = isChatMindRequest && opts?.chatMindMemoryEnabled ? String(opts?.chatMindMemorySummary || '').trim() : '';
  const memoryBlock = memorySummary ? `\n\nUser memory (opt-in; may be empty/partial):\n- ${memorySummary}` : '';

  const identityGuidance = `
Identity:
- If the user asks "who developed you / who made you / who built you", answer: "MindSparkle was developed by Ahmed Nabhan. This assistant is powered by GPT-5.2 and may use multiple AI providers depending on the request." Keep it to 1–2 sentences.
- Do not claim Ahmed Nabhan trained the underlying foundation model.
- If the user asks what model you are using, say GPT-5.2.`;

  const capabilityGuidance = `
Capabilities:
- If the user asks you to create a document, produce a well-structured output (Markdown by default) with a title, sections, and bullets.
- If the user asks you to create a presentation, produce slide-by-slide content with slide titles and bullet points.
- If the user asks for links, do NOT invent specific URLs you are unsure about. Prefer official documentation homepages and safe search queries.
- If the user asks for an image, provide a short image prompt suggestion (no extra commentary).`;

  const detectedLang = detectLanguageFromText(question || '');
  const languageGuidance = languageInstruction(detectedLang);

  // Web sources (best-effort). If available, we will include them and require citations.
  // If enabled but unavailable, we will still add a Sources section explaining that.
  let sources: WebSource[] = [];
  const wantsSources = isChatMindRequest ? false : shouldUseWebSearchForChat(question);
  if (wantsSources) {
    try {
      sources = await webSearch(question, 5);
    } catch (e: any) {
      console.warn('[openai-proxy] Web search failed; continuing without sources:', String(e?.message || e).slice(0, 200));
      sources = [];
    }
  }

  const citationGuidance = sources.length > 0
    ? `\n\nCitations:\n- You MUST cite sources using bracket numbers like [1], [2] inline.\n- After the answer, include a "Sources" section listing each source exactly once.\n- Do NOT invent URLs; only cite provided sources.`
    : '';

  const messages = [
    { role: "system", content: systemPrompt + (isChatMindRequest ? (modeGuidance(mode) + memoryBlock) : '') + identityGuidance + capabilityGuidance + languageGuidance + citationGuidance },
    ...(truncated.trim().length > 0
      ? [{ role: "user", content: `DOCUMENT CONTEXT (may be partial):\n${truncated.slice(0, 12000)}` }]
      : []),
    ...(sources.length > 0
      ? [{ role: 'user', content: `SOURCES (use for citations):\n\n${formatSourcesForPrompt(sources)}` }]
      : []),
    ...(Array.isArray(history) ? history.slice(isChatMindRequest ? -4 : -8) : []),
    { role: "user", content: question || "Hello" }
  ];

  // Requirement: AI Chat uses GPT-5.2 (edge function will fall back if unavailable).
  const providerOrder = chooseChatProviderOrder({ question, context: truncated, history });

  // Model selection is configurable via env vars. These defaults keep current behavior.
  const baseOpenAiModel = (Deno.env.get('OPENAI_CHAT_MODEL') || 'gpt-5.2').trim();
  const baseGeminiModel = (Deno.env.get('GEMINI_CHAT_MODEL') || Deno.env.get('GEMINI_TEXT_MODEL') || '').trim();
  const baseAnthropicModel = (Deno.env.get('ANTHROPIC_CHAT_MODEL') || Deno.env.get('ANTHROPIC_TEXT_MODEL') || 'claude-3-5-sonnet-latest').trim();

  // Pick specialized models when requested.
  const qLower = String(question || '').toLowerCase();
  const ctxLen = String(truncated || '').length;

  const hasCodeSignals =
    qLower.includes('```') ||
    qLower.includes('stack trace') ||
    qLower.includes('exception') ||
    qLower.includes('traceback') ||
    qLower.includes('typescript') ||
    qLower.includes('javascript') ||
    qLower.includes('react') ||
    qLower.includes('swift') ||
    qLower.includes('kotlin') ||
    qLower.includes('python') ||
    qLower.includes('sql') ||
    qLower.includes('bug') ||
    qLower.includes('error');

  const wantsSummarizeOrExtract =
    qLower.includes('summarize') ||
    qLower.includes('summary') ||
    qLower.includes('tl;dr') ||
    qLower.includes('extract') ||
    qLower.includes('key points') ||
    qLower.includes('main points') ||
    qLower.includes('outline');

  const wantsTranslate = qLower.includes('translate') || qLower.includes('ترجم') || qLower.includes('ترجمة');

  const wantsCreative =
    qLower.includes('write a story') ||
    qLower.includes('poem') ||
    qLower.includes('lyrics') ||
    qLower.includes('creative') ||
    qLower.includes('rewrite') ||
    qLower.includes('make it sound') ||
    qLower.includes('tone');

  const modelOverrides: Partial<Record<LlmProvider, string>> = {
    openai: baseOpenAiModel,
    gemini: baseGeminiModel,
    anthropic: baseAnthropicModel,
  };

  if (hasCodeSignals) {
    modelOverrides.openai = (Deno.env.get('OPENAI_CHAT_MODEL_CODE') || modelOverrides.openai || '').trim();
  }
  if ((ctxLen > 12000 && wantsSummarizeOrExtract) || (ctxLen > 8000 && wantsTranslate)) {
    modelOverrides.gemini = (Deno.env.get('GEMINI_CHAT_MODEL_LONG') || modelOverrides.gemini || '').trim();
  }
  if (wantsCreative) {
    modelOverrides.anthropic = (Deno.env.get('ANTHROPIC_CHAT_MODEL_CREATIVE') || modelOverrides.anthropic || '').trim();
  }

  const maxTokens = isChatMindRequest ? 700 : 900;
  const temp = isChatMindRequest ? 0.25 : 0.35;
  const answer = await callOpenAI(messages, maxTokens, temp, modelOverrides.openai || "gpt-5.2", meta, providerOrder, modelOverrides);

  // Optional verify pass (best-effort) to improve accuracy for general chat.
  // Disabled by default; enable via env var to avoid doubling cost for all chats.
  const enableVerify = parseOptionalBoolEnv('ENABLE_CHAT_VERIFY');
  const verifyOnlyWithSources = parseOptionalBoolEnv('CHAT_VERIFY_ONLY_WITH_SOURCES');
  const isGeneralChat = String(meta?.requestType || '') === 'chatMind' || String(meta?.requestType || '') === 'chat';
  const looksFactual = (() => {
    const q = String(question || '').toLowerCase();
    if (!q) return false;
    if (q.includes('latest') || q.includes('today') || q.includes('current') || q.includes('202') || q.includes('news')) return true;
    if (q.startsWith('who ') || q.startsWith('what ') || q.startsWith('when ') || q.startsWith('where ') || q.startsWith('which ') || q.startsWith('how many ')) return true;
    if (q.includes('price') || q.includes('cost') || q.includes('version') || q.includes('release') || q.includes('date')) return true;
    return false;
  })();

  let verifiedAnswer = answer;
  if (enableVerify && isGeneralChat && (wantsSources || looksFactual) && (!verifyOnlyWithSources || sources.length > 0)) {
    try {
      const verifierSystem = `You are a meticulous fact-checking editor.
Rules:
- If SOURCES are provided, ONLY make claims supported by SOURCES.
- Keep existing citation markers like [1], [2] and do NOT invent new URLs.
- If a claim is not supported, remove it or rewrite with uncertainty.
- If the user question is ambiguous, ask 1 short clarifying question.
- Be concise.`;

      const verifierUser = `User question:\n${String(question || '').slice(0, 6000)}\n\nDraft answer:\n${String(answer || '').slice(0, 12000)}\n\nSOURCES (if any):\n${sources.length > 0 ? formatSourcesForPrompt(sources) : '(none)'}\n\nReturn an improved final answer (plain text).`;

      const verifyMeta: LlmCallMeta | undefined = meta
        ? { ...meta, requestType: `${String(meta.requestType)}_verify` }
        : undefined;

      verifiedAnswer = await callOpenAI(
        [
          { role: 'system', content: verifierSystem },
          { role: 'user', content: verifierUser },
        ],
        900,
        0.2,
        modelOverrides.openai || 'gpt-5.2',
        verifyMeta,
        providerOrder,
        modelOverrides,
      );
    } catch (e: any) {
      console.warn('[openai-proxy] Verify pass failed; returning draft answer:', String(e?.message || e).slice(0, 200));
      verifiedAnswer = answer;
    }
  }

  // Ensure a sources section exists when sources are enabled.
  if (wantsSources) {
    const hasSourcesSection = /\n\s*sources\s*:?\s*\n/i.test(verifiedAnswer);
    const sourcesText = sources.length > 0
      ? formatSourcesForResponse(sources)
      : `- (No web sources available for this answer)`;
    return hasSourcesSection
      ? verifiedAnswer
      : `${verifiedAnswer.trim()}\n\nSources:\n${sourcesText}`;
  }

  return verifiedAnswer;
}

function listAgents(): { id: string; name: string; description?: string }[] {
  const agents: { id: string; name: string; description?: string }[] = [];

  agents.push({
    id: 'general',
    name: 'General Study Assistant',
    description: 'General-purpose tutor for any topic.',
  });

  for (const [key, value] of Object.entries(VENDOR_KNOWLEDGE)) {
    agents.push({
      id: key,
      name: key,
      description: Array.isArray((value as any)?.keyAreas) && (value as any).keyAreas.length > 0
        ? `Exam-focused coach. Key areas: ${(value as any).keyAreas.slice(0, 6).join(', ')}.`
        : 'Exam-focused coach.',
    });
  }

  return agents;
}

// ========== INTERVIEW QUESTIONS ==========
async function generateInterview(content: string, count = 10, language = "en", meta?: LlmCallMeta): Promise<any[]> {
  const truncated = (content || "").slice(0, MAX_CONTENT_LENGTH);
  const vendorInfo = await detectVendorAI(truncated, meta);
  const vendorExpertise = getVendorExpertise(vendorInfo.vendor);
  
  const systemPrompt = vendorExpertise
    ? vendorExpertise.expertise + " You are also an expert interview coach. Generate interview questions that test practical knowledge and real-world understanding."
    : "You are an expert interview coach helping candidates prepare for technical job interviews. Generate challenging but fair interview questions.";
  
  const focusAreas = vendorExpertise 
    ? `\nKey areas to cover: ${vendorExpertise.keyAreas.join(', ')}`
    : '';

  const prompt = `Create ${count} interview questions${vendorInfo.vendor !== "General" ? ` for a ${vendorInfo.vendor} ${vendorInfo.category} position` : ''}.${focusAreas}

Requirements:
- Mix of technical questions, scenario-based questions, and behavioral questions
- Include expected answer key points
- Questions should range from entry-level to advanced
- Focus on practical knowledge that employers value

Return ONLY valid JSON array:
[
  {
    "question": "The interview question",
    "type": "technical|scenario|behavioral",
    "difficulty": "easy|medium|hard",
    "keyPoints": ["Point 1", "Point 2", "Point 3"],
    "followUp": "A potential follow-up question"
  }
]

${language !== 'en' ? `Language: ${language === 'ar' ? 'Arabic' : language}` : ''}

Document Content:
${truncated}`;

  const result = await callOpenAI([
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt }
  ], 8000, 0.4, undefined, meta);
  
  try {
    const match = result.match(/\[[\s\S]*\]/);
    return match ? JSON.parse(match[0]) : [];
  } catch {
    return [];
  }
}

// ========== MAIN HANDLER ==========
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  // Handle GET requests (browser access)
  if (req.method === "GET") {
    const info = {
      name: "MindSparkle AI API",
      version: "3.1",
      status: "online",
      description: "AI-powered exam preparation with vendor-specific expertise",
      supportedVendors: Object.keys(VENDOR_KNOWLEDGE),
      endpoints: {
        summarize: "Generate comprehensive study summaries with tables",
        quiz: "Create exam-style multiple choice questions",
        studyGuide: "Generate detailed study guides",
        flashcards: "Create learning flashcards",
        chat: "Document Q&A with AI tutor",
        detectVendor: "AI-based vendor/certification detection"
      },
      usage: "POST with JSON body: {action: 'test'} to verify connection"
    };
    return new Response(JSON.stringify(info, null, 2), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });
  }
  
  try {
    // Parse body first for test action
    const body = await req.json();
    const { action, content, language = "en", count, difficulty, question, history, title, source, bullets, focusTopics, agentId } = body;
    // Backwards compatible aliases used by older clients
    const rawContentCompat = (typeof content === 'string' ? content : (typeof body?.context === 'string' ? body.context : ''));
    // Soft-truncate content to avoid 413s for large documents.
    // Many endpoints (chat, quiz, study plan, etc) can safely operate on partial context.
    if (typeof rawContentCompat === 'string' && rawContentCompat.length > HARD_CONTENT_LENGTH) {
      return new Response(
        JSON.stringify({ code: 413, message: "Content too large" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const contentCompat = (typeof rawContentCompat === 'string')
      ? rawContentCompat.slice(0, MAX_CONTENT_LENGTH)
      : '';
    const questionCompat = (typeof question === 'string' ? question : (typeof body?.message === 'string' ? body.message : ''));
    
    // Allow test without auth
    if (action === "test") {
      return new Response(
        JSON.stringify({
          status: "ok",
          version: "3.1-vendor-expertise",
          hasOpenAIKey: Boolean(Deno.env.get("OPENAI_API_KEY")),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const isChatMindAction = ['chatMind', 'chatMindStream'].includes(String(action));
    const auth = req.headers.get("authorization");

    // Verify JWT (if provided). Allow guest ChatMind if auth is missing/invalid.
    const supabaseUrl = Deno.env.get("PROJECT_URL") || Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    let supabase: any = null;
    let user: any = null;
    let isGuest = false;
    let guestId = '';

    if (!auth) {
      if (!isChatMindAction) {
        return new Response(JSON.stringify({ code: 401, message: "Missing authorization header" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      isGuest = true;
    } else {
      if (!supabaseUrl || !supabaseKey) {
        return new Response(JSON.stringify({ code: 500, message: "Server config error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      supabase = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: auth } } });
      const { data: { user: authedUser }, error: authError } = await supabase.auth.getUser();
      user = authedUser;

      if (authError || !user) {
        if (!isChatMindAction) {
          return new Response(JSON.stringify({ code: 401, message: "Invalid JWT" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        isGuest = true;
      }
    }

    if (isGuest) {
      guestId = String(body?.guestId || body?.deviceId || '').trim();
      if (!guestId) {
        return new Response(JSON.stringify({ code: 401, message: "Guest ID required" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Best-effort burst limiting (optional; set AI_BURST_REQUESTS_PER_MINUTE).
    const burst = checkBurstLimit(isGuest ? `guest:${guestId}` : user.id);
    if (!burst.ok) {
      return new Response(
        JSON.stringify({ code: 429, message: "Rate limited. Please retry." }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(burst.retryAfterSec),
          },
        },
      );
    }

    // Optional daily request cap (uses ai_provider_usage table).
    if (!isGuest) {
      const dailyLimit = parseOptionalNumberEnv('AI_DAILY_REQUEST_LIMIT');
      if (dailyLimit && dailyLimit > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const { count: usedToday } = await supabase
          .from('ai_provider_usage')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('usage_date', today);

        if ((usedToday || 0) >= dailyLimit) {
          return new Response(
            JSON.stringify({ code: 429, message: "Daily AI limit reached." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }

    // Free-tier daily chat caps (server-side backstop).
    // Client already enforces this, but server-side prevents bypass via reinstall/clearing storage.
    if (isGuest) {
      const guestLimit = parseOptionalNumberEnv('FREE_CHATMIND_DAILY_LIMIT_GUEST') || parseOptionalNumberEnv('FREE_CHATMIND_DAILY_LIMIT') || 30;
      if (isChatMindAction) {
        const ok = checkGuestDailyLimit(`guest:${guestId}`, guestLimit);
        if (!ok.ok) {
          return new Response(
            JSON.stringify({ code: 429, message: 'Daily ChatMind limit reached. Please sign in for unlimited access.' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }
    }

    if (!isGuest) {
      const premium = await isPremiumUser(supabase, user.id);
      if (!premium) {
        // ChatMind gets its own higher cap.
        const freeChatMindDailyLimit = parseOptionalNumberEnv('FREE_CHATMIND_DAILY_LIMIT') || 30;
        if (freeChatMindDailyLimit > 0) {
          const chatMindActions = ['chatMind', 'chatMindStream'];
          if (chatMindActions.includes(String(action))) {
            const today = new Date().toISOString().slice(0, 10);
            const { count: usedChatMindToday } = await supabase
              .from('ai_provider_usage')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .eq('usage_date', today)
              .in('request_type', chatMindActions);

            if ((usedChatMindToday || 0) >= freeChatMindDailyLimit) {
              return new Response(
                JSON.stringify({ code: 429, message: 'Daily ChatMind limit reached. Try again tomorrow.' }),
                { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
              );
            }
          }
        }

        // General chat cap (excludes ChatMind).
        const freeChatDailyLimit = parseOptionalNumberEnv('FREE_CHAT_DAILY_LIMIT') || 10;
        if (freeChatDailyLimit > 0) {
          const chatActions = ['chat', 'docChat', 'chatStream', 'docChatStream'];
          const today = new Date().toISOString().slice(0, 10);
          const { count: usedChatToday } = await supabase
            .from('ai_provider_usage')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('usage_date', today)
            .in('request_type', chatActions);

          if ((usedChatToday || 0) >= freeChatDailyLimit) {
            return new Response(
              JSON.stringify({ code: 429, message: 'Daily chat limit reached.' }),
              { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
            );
          }
        }
      }
    }

    // Optional per-feature daily limits for free users (server-side backstop).
    // Disabled by default unless you set the corresponding env vars.
    if (!isGuest) {
      const premiumForFeatureCaps = await isPremiumUser(supabase, user.id);
      if (!premiumForFeatureCaps) {
        const today = new Date().toISOString().slice(0, 10);
        const actionToEnv: Record<string, { env: string; label: string }> = {
          quiz: { env: 'FREE_QUIZ_DAILY_LIMIT', label: 'quiz' },
          studyPlan: { env: 'FREE_STUDYPLAN_DAILY_LIMIT', label: 'study plan' },
          interview: { env: 'FREE_INTERVIEW_DAILY_LIMIT', label: 'interview' },
        };

        const cfg = actionToEnv[String(action)];
        if (cfg) {
          const limit = parseOptionalNumberEnv(cfg.env);
          if (limit && limit > 0) {
            const { count: usedToday } = await supabase
              .from('ai_provider_usage')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .eq('usage_date', today)
              .eq('request_type', String(action));

            if ((usedToday || 0) >= limit) {
              return new Response(
                JSON.stringify({ code: 429, message: `Daily ${cfg.label} limit reached.` }),
                { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
              );
            }
          }
        }
      }
    }

    // Input validation to prevent accidental huge payloads.
    if (typeof action !== 'string' || !action.trim()) {
      return new Response(JSON.stringify({ code: 400, message: "Missing action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // NOTE: Content length is validated/truncated above (rawContentCompat -> contentCompat).
    if (Array.isArray(history) && history.length > 50) {
      return new Response(JSON.stringify({ code: 400, message: "Chat history too long" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const meta: LlmCallMeta | undefined = (!isGuest && user && supabase)
      ? {
          supabase,
          userId: user.id,
          requestType: String(action),
          documentId: (typeof body?.documentId === 'string' ? body.documentId : null),
        }
      : undefined;
    
    let result: any;
    
    switch (action) {
      case "listAgents":
        result = { agents: listAgents() };
        break;
      case "chatMindMemory": {
        const op = String(body?.op || '').trim().toLowerCase();
        if (op === 'clear') {
          await clearChatMindMemory(supabase, user.id);
          result = { ok: true };
        } else {
          const summary = await getChatMindMemorySummary(supabase, user.id);
          result = { summary };
        }
        break;
      }
      case "summarize":
        result = { summary: await summarize(contentCompat, language, meta) };
        break;
      case "summarizeModule":
        result = { module: await summarizeModuleJSON({ title: title || 'Module', content: contentCompat || '', language, source, meta }) };
        break;
      case "quiz":
        result = { questions: await generateQuiz(contentCompat, count || 10, difficulty || "medium", language, focusTopics, meta) };
        break;
      case "studyPlan":
        result = { plan: await generateStudyPlan(contentCompat, language, meta) };
        break;
      case "studyGuide":
        result = { guide: await generateStudyGuide(contentCompat, language, meta) };
        break;
      case "flashcards":
        result = { flashcards: await generateFlashcards(contentCompat, count || 20, language, meta) };
        break;
      case "chat":
        result = { response: await chat(contentCompat, questionCompat, history || [], meta, agentId) };
        break;

      case "docChat":
        // Explicit document chat action (isolated from Chat Mind)
        result = { response: await chat(contentCompat, questionCompat, history || [], meta, agentId) };
        break;

      case "chatMind":
        // Chat Mind should not receive document context.
        {
          const memoryEnabled = !isGuest && Boolean(body?.memory?.enabled);
          const chatMode = normalizeChatMindMode(body?.chatMindMode);
          if (!isGuest && Boolean(body?.memory?.forget)) {
            await clearChatMindMemory(supabase, user.id);
          }
          const memorySummary = memoryEnabled ? await getChatMindMemorySummary(supabase, user.id) : '';

          const responseText = await chat('', questionCompat, history || [], meta, agentId, {
            chatMindMode: chatMode,
            chatMindMemoryEnabled: memoryEnabled,
            chatMindMemorySummary: memorySummary,
          });

          if (!isGuest && memoryEnabled && shouldUpdateChatMindMemory(questionCompat)) {
            updateChatMindMemorySummary({
              supabase,
              userId: user.id,
              previousSummary: memorySummary,
              userMessage: questionCompat,
              assistantMessage: responseText,
            });
          }

          result = { response: responseText };
        }
        break;

      case "chatStream":
      case "docChatStream":
      case "chatMindStream": {
        // Stream tokens over SSE. Prefer OpenAI to enable real upstream streaming.
        const selectedAgent = typeof agentId === 'string' ? agentId.trim() : '';
        const agentExpertise = selectedAgent ? getVendorExpertise(selectedAgent) : null;

        const systemPrompt = agentExpertise
          ? `${agentExpertise.expertise}
You are the MindSparkle ${selectedAgent} Agent.
Be concise and clear by default. If the user asks for detail, expand.
Use exam tips when helpful. Focus areas: ${agentExpertise.keyAreas.join(', ')}.
If context is missing, ask 1 short clarifying question.
Accuracy first: do not guess. If unsure, say you are not sure and suggest a next step.
Prefer structured answers: short summary, then bullets/steps when useful.`
          : "You are a helpful AI study assistant. Be concise and clear by default. If the user asks for detail, expand. If context is missing, ask 1 short clarifying question. Accuracy first: do not guess. If unsure, say you are not sure and suggest a next step. Prefer structured answers: short summary, then bullets/steps when useful.";

        const identityGuidance = `
Identity:
- If the user asks "who developed you / who made you / who built you", answer: "MindSparkle was developed by Ahmed Nabhan. This assistant is powered by GPT-5.2 and may use multiple AI providers depending on the request." Keep it to 1–2 sentences.
- Do not claim Ahmed Nabhan trained the underlying foundation model.
- If the user asks what model you are using, say GPT-5.2.`;

        const capabilityGuidance = `
Capabilities:
- If the user asks you to create a document, produce a well-structured output (Markdown by default) with a title, sections, and bullets.
- If the user asks you to create a presentation, produce slide-by-slide content with slide titles and bullet points.
- If the user asks for links, do NOT invent specific URLs you are unsure about. Prefer official documentation homepages and safe search queries.
- If the user asks for an image, provide a short image prompt suggestion (no extra commentary).`;

        const isChatMindStream = action === 'chatMindStream';
        const includeDocContext = action !== 'chatMindStream';
        const truncatedCtx = includeDocContext ? String(contentCompat || '').slice(0, 25000) : '';
        const q = String(questionCompat || '').trim() || 'Hello';

        const detectedLang = detectLanguageFromText(q);
        const languageGuidance = languageInstruction(detectedLang);

        const memoryEnabled = isChatMindStream && !isGuest ? Boolean(body?.memory?.enabled) : false;
        const chatMode = isChatMindStream ? normalizeChatMindMode(body?.chatMindMode) : 'general';
        if (isChatMindStream && !isGuest && Boolean(body?.memory?.forget)) {
          await clearChatMindMemory(supabase, user.id);
        }
        const memorySummary = isChatMindStream && !isGuest && memoryEnabled ? await getChatMindMemorySummary(supabase, user.id) : '';
        const memoryBlock = memorySummary ? `\n\nUser memory (opt-in; may be empty/partial):\n- ${memorySummary}` : '';

        let sources: WebSource[] = [];
        if (!isChatMindStream && shouldUseWebSearchForChat(q)) {
          try {
            sources = await webSearch(q, 5);
          } catch {
            sources = [];
          }
        }

        const citationGuidance = sources.length > 0
          ? `

Citations:
- You MUST cite sources using bracket numbers like [1], [2] inline.
- After the answer, include a "Sources" section listing each source exactly once.
- Do NOT invent URLs; only cite provided sources.`
          : '';

        const messages = [
          { role: 'system', content: systemPrompt + (isChatMindStream ? (modeGuidance(chatMode) + memoryBlock) : '') + identityGuidance + capabilityGuidance + languageGuidance + citationGuidance },
          ...(truncatedCtx.trim().length > 0
            ? [{ role: 'user', content: `DOCUMENT CONTEXT (may be partial):\n${truncatedCtx.slice(0, 12000)}` }]
            : []),
          ...(sources.length > 0
            ? [{ role: 'user', content: `SOURCES (use for citations):\n\n${formatSourcesForPrompt(sources)}` }]
            : []),
          ...(Array.isArray(history) ? history.slice(isChatMindStream ? -4 : -8) : []),
          { role: 'user', content: q },
        ];

        const fastModel = (Deno.env.get('OPENAI_CHAT_MODEL_FAST') || '').trim();
        const smartModel = (Deno.env.get('OPENAI_CHAT_MODEL') || 'gpt-5.2').trim();
        const qLower = q.toLowerCase();
        const isSimple = q.length > 0 && q.length < 220 && !qLower.includes('```') && !qLower.includes('error') && !qLower.includes('stack trace');
        const openAiModel = fastModel && (isChatMindStream || isSimple) ? fastModel : smartModel;

        const providerOrder = chooseChatProviderOrder({ question: q, context: truncatedCtx, history });
        const primaryProvider = providerOrder[0] || 'openai';

        if (primaryProvider !== 'openai') {
          const txt = await callOpenAI(messages, 900, 0.35, undefined, meta, [primaryProvider]);
          return new Response(chunkTextSse(txt), { headers: sseHeaders() });
        }

        try {
          const maxTokens = isChatMindStream ? 700 : 900;
          const temp = isChatMindStream ? 0.25 : 0.35;
          const upstream = await callOpenAIInternalStream(messages, maxTokens, temp, openAiModel);
          const encoder = new TextEncoder();
          const decoder = new TextDecoder();

          const stream = new ReadableStream<Uint8Array>({
            async start(controller) {
              try {
                const reader = upstream.body?.getReader();
                if (!reader) {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  controller.close();
                  return;
                }

                let buffer = '';
                let assistantAcc = '';
                while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  buffer += decoder.decode(value, { stream: true });

                  // Parse SSE from OpenAI.
                  let split;
                  while ((split = buffer.indexOf('\n\n')) !== -1) {
                    const frame = buffer.slice(0, split);
                    buffer = buffer.slice(split + 2);
                    const lines = frame.split(/\r?\n/);
                    for (const line of lines) {
                      const trimmed = line.trim();
                      if (!trimmed.startsWith('data:')) continue;
                      const payload = trimmed.replace(/^data:\s*/, '');
                      if (!payload) continue;
                      if (payload === '[DONE]') {
                        if (isChatMindStream && memoryEnabled && assistantAcc.trim() && shouldUpdateChatMindMemory(q)) {
                          updateChatMindMemorySummary({
                            supabase,
                            userId: user.id,
                            previousSummary: memorySummary,
                            userMessage: q,
                            assistantMessage: assistantAcc,
                          });
                        }
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                        controller.close();
                        return;
                      }
                      try {
                        const obj = JSON.parse(payload);
                        const delta = obj?.choices?.[0]?.delta?.content;
                        if (typeof delta === 'string' && delta.length > 0) {
                          assistantAcc += delta;
                          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: delta })}\n\n`));
                        }
                      } catch {
                        // ignore malformed frames
                      }
                    }
                  }
                }

                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              } catch {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                controller.close();
              }
            },
          });

          return new Response(stream, { headers: sseHeaders() });
        } catch (e: any) {
          // Fallback: non-streaming answer chunked.
          const txt = await chat(contentCompat, questionCompat, history || [], meta, agentId);
          return new Response(chunkTextSse(txt), { headers: sseHeaders() });
        }
      }

      case "generateModuleImage":
        result = { imageDataUrl: await generateModuleImageDataUrl({ title: title || 'Module', bullets, language }) };
        break;
      case "generateImage":
        result = { imageDataUrl: await generateImageDataUrl(String(body?.prompt || ''), String(body?.image_mode || body?.imageMode || '')) };
        break;

      case "exportFile": {
        const kind = normalizeExportKind(String(body?.kind || 'notes'));
        const message = typeof body?.message === 'string' ? body.message : '';
        const ctx = typeof body?.content === 'string' ? body.content : contentCompat;
        const hist = Array.isArray(body?.history) ? body.history : (Array.isArray(history) ? history : []);

        const { filename, mimeType, content: fileText } = await generateExportContent({
          kind,
          message,
          context: String(ctx || ''),
          history: hist,
          agentId,
          meta,
        });

        // Upload to Storage using service role if available.
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_KEY');
        const storageClient = serviceKey ? createClient(supabaseUrl, serviceKey) : supabase;

        const exportPath = `exports/${user.id}/${crypto.randomUUID()}/${filename}`;
        const bytes = new TextEncoder().encode(fileText);
        const { error: upErr } = await storageClient.storage
          .from('doc_assets')
          .upload(exportPath, bytes, { contentType: mimeType, upsert: true });

        if (upErr) throw new Error(`Export upload failed: ${upErr.message}`);

        const { data: signed, error: signErr } = await storageClient.storage
          .from('doc_assets')
          .createSignedUrl(exportPath, 1800);

        if (signErr || !signed?.signedUrl) throw new Error(`Export link failed: ${signErr?.message || 'unknown'}`);

        result = { url: signed.signedUrl, filename, mimeType };
        break;
      }
      case "interview": {
        // Support both old format (content=full prompt) and new format (content=document)
        const isLegacyFormat = contentCompat && contentCompat.includes('Return a JSON array with this format');
        if (isLegacyFormat) {
          // Legacy format: content is already the full prompt
          const interviewResult = await callOpenAI([
            { role: "system", content: "You are an expert interview coach helping candidates prepare for technical job interviews." },
            { role: "user", content: contentCompat }
          ], 4096, 0.3, undefined, meta);
          result = { response: interviewResult };
        } else {
          // New format: generate questions from document content
          result = { questions: await generateInterview(contentCompat, count || 10, language, meta) };
        }
        break;
      }
      case "testVendor":
        result = await detectVendorAI(content || "", meta);
        break;
      case "detectVendor":
        result = await detectVendorAI(content, meta);
        break;
      default:
        return new Response(JSON.stringify({ code: 400, message: `Unknown action: ${action}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    
  } catch (error) {
    // Stateless logging: avoid printing raw error objects.
    console.error("Error:", String((error as any)?.message || error).slice(0, 200));
    const status = (error as any)?.status && Number((error as any).status) ? Number((error as any).status) : 500;
    return new Response(JSON.stringify({ code: status, message: error.message || "Internal server error" }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
