/**
 * Vendor Detection Engine
 * 
 * Detects document vendors (Cisco, AWS, Microsoft, Google, etc.)
 * Uses keyword matching, CLI patterns, and certification detection
 * Returns vendor config with logo, colors, and AI rules
 */

import { VendorId, VendorConfig, VendorDetectionResult, VendorAIRules } from './types';

// ============================================
// VENDOR CONFIGURATIONS
// ============================================

export const VENDOR_CONFIGS: Record<VendorId, VendorConfig> = {
  cisco: {
    id: 'cisco',
    name: 'Cisco Systems',
    logo: '🔵', // Will be replaced with actual logo URL
    color: '#049FD9',
    keywords: [
      'cisco', 'ios', 'ios-xe', 'ios-xr', 'nx-os', 'asa', 'firepower', 'fmc',
      'ccna', 'ccnp', 'ccie', 'ccent', 'devnet', 'cyberops',
      'catalyst', 'nexus', 'meraki', 'webex', 'umbrella', 'duo',
      'eigrp', 'ospf', 'bgp', 'hsrp', 'vrrp', 'glbp', 'pvst',
      'vlan', 'stp', 'rstp', 'mstp', 'vpc', 'vxlan', 'evpn',
      'acl', 'nat', 'pat', 'dhcp snooping', 'port-security', 'dot1x',
      'aaa', 'tacacs', 'radius', 'ise', 'ipsec', 'gre', 'dmvpn',
      'sd-wan', 'aci', 'ucs', 'intersight', 'dna center', 'dnac',
      'packet tracer', 'netacad', 'networking academy',
      'show running-config', 'show ip route', 'configure terminal',
    ],
    cliPatterns: [
      /^[A-Za-z0-9_-]+[#>]\s*.+/gm,                    // Router# or Switch>
      /^\s*(config|interface|router|line|vlan)\)?[#>]?\s*.+/gm,
      /^\s*(no\s+)?ip\s+(address|route|nat|access-list)/gm,
      /^\s*(no\s+)?switchport\s+(mode|access|trunk)/gm,
      /^\s*show\s+(ip|running|startup|interface|vlan|cdp|lldp)/gm,
      /^\s*(enable|disable|configure|exit|end)\s*$/gm,
      /^\s*hostname\s+\S+/gm,
      /^\s*(username|password|secret|enable\s+secret)\s+/gm,
      /^\s*spanning-tree\s+(mode|portfast|guard)/gm,
      /^\s*router\s+(ospf|eigrp|bgp|rip)\s+\d*/gm,
    ],
    certifications: ['CCNA', 'CCNP', 'CCIE', 'CCENT', 'DevNet', 'CyberOps'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'expert',
      outputFormat: 'exam-prep',
      specialInstructions: [
        'Preserve all CLI command syntax exactly as shown',
        'Include command prompts (Router#, Switch>, etc.)',
        'Highlight IOS version differences when relevant',
        'Include administrative distance and metric values',
        'Reference Cisco documentation for accuracy',
      ],
    },
  },

  aws: {
    id: 'aws',
    name: 'Amazon Web Services',
    logo: '🟠',
    color: '#FF9900',
    keywords: [
      'aws', 'amazon web services', 'ec2', 's3', 'lambda', 'rds', 'vpc',
      'iam', 'cloudformation', 'cloudwatch', 'cloudtrail', 'route53',
      'elastic load balancer', 'elb', 'alb', 'nlb', 'auto scaling',
      'dynamodb', 'aurora', 'redshift', 'elasticache', 'sqs', 'sns',
      'ecs', 'eks', 'fargate', 'ecr', 'codepipeline', 'codebuild',
      'api gateway', 'cognito', 'secrets manager', 'kms', 'waf',
      'solutions architect', 'saa-c03', 'sysops', 'developer associate',
      'aws cli', 'boto3', 'cloudfront', 'global accelerator',
      'security group', 'nacl', 'internet gateway', 'nat gateway',
    ],
    cliPatterns: [
      /aws\s+[a-z0-9-]+\s+[a-z0-9-]+/gm,              // aws s3 ls
      /\$\s*aws\s+/gm,                                 // $ aws
      /arn:aws:[a-z0-9-]+:[a-z0-9-]*:\d*:/gm,        // ARN pattern
      /s3:\/\/[a-z0-9.-]+/gm,                         // S3 URIs
      /--[a-z-]+\s+(["']?)[^"'\s]+\1/gm,             // CLI flags
    ],
    certifications: ['SAA-C03', 'DVA-C02', 'SOA-C02', 'SAP-C02', 'DOP-C02'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: [
        'Preserve AWS CLI commands exactly',
        'Include ARN formats when relevant',
        'Highlight service limits and quotas',
        'Include pricing tier references when mentioned',
        'Reference AWS Well-Architected Framework principles',
      ],
    },
  },

  microsoft: {
    id: 'microsoft',
    name: 'Microsoft',
    logo: '🟦',
    color: '#00A4EF',
    keywords: [
      'microsoft', 'azure', 'microsoft 365', 'm365', 'office 365',
      'active directory', 'ad', 'azure ad', 'entra id', 'intune',
      'windows server', 'hyper-v', 'sccm', 'scom', 'exchange',
      'sharepoint', 'teams', 'onedrive', 'power platform', 'power bi',
      'az-104', 'az-900', 'az-204', 'az-305', 'az-500', 'ms-900',
      'powershell', 'azure cli', 'arm template', 'bicep',
      'virtual machine', 'app service', 'azure functions', 'cosmos db',
      'azure sql', 'blob storage', 'azure devops', 'microsoft defender',
    ],
    cliPatterns: [
      /az\s+[a-z0-9-]+\s+[a-z0-9-]+/gm,              // az vm create
      /\$\s*az\s+/gm,                                 // $ az
      /Get-Az[A-Za-z]+/gm,                           // PowerShell Az
      /New-Az[A-Za-z]+/gm,
      /Set-Az[A-Za-z]+/gm,
      /Remove-Az[A-Za-z]+/gm,
      /Connect-AzAccount/gm,
      /\/subscriptions\/[a-f0-9-]+\//gm,             // Resource IDs
    ],
    certifications: ['AZ-900', 'AZ-104', 'AZ-204', 'AZ-305', 'AZ-500', 'AZ-400'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: [
        'Preserve Azure CLI and PowerShell commands exactly',
        'Include resource naming conventions',
        'Highlight RBAC roles and permissions',
        'Reference Microsoft Learn documentation',
      ],
    },
  },

  google: {
    id: 'google',
    name: 'Google Cloud',
    logo: '🔴',
    color: '#4285F4',
    keywords: [
      'google cloud', 'gcp', 'gcloud', 'google cloud platform',
      'compute engine', 'cloud storage', 'bigquery', 'cloud sql',
      'cloud functions', 'cloud run', 'gke', 'kubernetes engine',
      'cloud pub/sub', 'cloud spanner', 'firestore', 'firebase',
      'cloud iam', 'cloud kms', 'vpc network', 'cloud armor',
      'associate cloud engineer', 'professional cloud architect',
      'gsutil', 'bq', 'kubectl', 'cloud shell', 'cloud build',
    ],
    cliPatterns: [
      /gcloud\s+[a-z0-9-]+\s+[a-z0-9-]+/gm,         // gcloud compute instances
      /\$\s*gcloud\s+/gm,                            // $ gcloud
      /gsutil\s+(ls|cp|mv|rm|mb|rb)/gm,             // gsutil commands
      /bq\s+(query|load|extract|mk)/gm,             // BigQuery CLI
      /projects\/[a-z0-9-]+\//gm,                   // Resource paths
    ],
    certifications: ['ACE', 'PCA', 'PDE', 'PCSE', 'PCNE'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: [
        'Preserve gcloud and gsutil commands exactly',
        'Include project and region references',
        'Highlight IAM roles and permissions',
      ],
    },
  },

  comptia: {
    id: 'comptia',
    name: 'CompTIA',
    logo: '🟢',
    color: '#C8202F',
    keywords: [
      'comptia', 'a+', 'network+', 'security+', 'linux+', 'cloud+',
      'cysa+', 'pentest+', 'casp+', 'server+', 'data+', 'project+',
      'core 1', 'core 2', 'n10-008', 'sy0-601', 'sy0-701',
      'osi model', 'tcp/ip', 'troubleshooting methodology',
      'risk management', 'threat actor', 'vulnerability',
      'encryption', 'authentication', 'authorization',
    ],
    cliPatterns: [
      /^(C:\\|PS\s*>|#|\$)\s*.+/gm,                  // Windows/Linux prompts
      /netstat\s+-[a-z]+/gm,
      /ipconfig\s*\/[a-z]+/gm,
      /ifconfig|ip\s+addr/gm,
      /nmap\s+-[a-zA-Z]+/gm,
    ],
    certifications: ['A+', 'Network+', 'Security+', 'CySA+', 'PenTest+', 'CASP+'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: false,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'intermediate',
      outputFormat: 'exam-prep',
      specialInstructions: [
        'Focus on exam objectives',
        'Include acronym expansions',
        'Highlight performance-based question topics',
        'Use CompTIA terminology precisely',
      ],
    },
  },

  vmware: {
    id: 'vmware',
    name: 'VMware',
    logo: '🟤',
    color: '#717074',
    keywords: [
      'vmware', 'vsphere', 'vcenter', 'esxi', 'vsan', 'nsx',
      'vmotion', 'drs', 'ha', 'fault tolerance', 'vrealize',
      'horizon', 'workspace one', 'tanzu', 'cloud foundation',
      'vcp', 'vcap', 'vcdx', 'vmdk', 'datastore', 'dvs',
    ],
    cliPatterns: [
      /esxcli\s+[a-z]+/gm,
      /vim-cmd\s+[a-z]+/gm,
      /govc\s+[a-z]+/gm,
      /\[datastore\d*\]/gm,
    ],
    certifications: ['VCP-DCV', 'VCAP', 'VCDX'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'reference',
      specialInstructions: [
        'Preserve ESXi CLI commands exactly',
        'Include vSphere version differences',
        'Highlight licensing tier features',
      ],
    },
  },

  redhat: {
    id: 'redhat',
    name: 'Red Hat',
    logo: '🔴',
    color: '#EE0000',
    keywords: [
      'red hat', 'rhel', 'centos', 'fedora', 'openshift', 'ansible',
      'rhcsa', 'rhce', 'rhca', 'satellite', 'subscription manager',
      'systemd', 'firewalld', 'selinux', 'podman', 'buildah',
      'dnf', 'yum', 'rpm', 'kickstart', 'pacemaker', 'corosync',
    ],
    cliPatterns: [
      /^\$\s*(sudo\s+)?(dnf|yum|rpm|systemctl|firewall-cmd)/gm,
      /ansible(-playbook|-galaxy)?\s+/gm,
      /oc\s+(get|create|delete|apply)/gm,           // OpenShift CLI
      /semanage\s+[a-z]+/gm,
      /subscription-manager\s+[a-z]+/gm,
    ],
    certifications: ['RHCSA', 'RHCE', 'RHCA', 'EX200', 'EX294'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: [
        'Preserve Linux commands exactly',
        'Include SELinux contexts when relevant',
        'Highlight RHEL version differences',
      ],
    },
  },

  fortinet: {
    id: 'fortinet',
    name: 'Fortinet',
    logo: '🔴',
    color: '#EE3124',
    keywords: [
      'fortinet', 'fortigate', 'fortianalyzer', 'fortimanager',
      'fortios', 'forticlient', 'fortisandbox', 'fortimail',
      'nse4', 'nse5', 'nse6', 'nse7', 'nse8', 'fcnsa', 'fcnsp',
      'security fabric', 'utm', 'ngfw', 'sd-wan', 'ztna',
    ],
    cliPatterns: [
      /^[A-Za-z0-9_-]+\s+[#\$]\s*/gm,
      /config\s+(firewall|system|vpn|router)/gm,
      /edit\s+\d+/gm,
      /set\s+[a-z-]+\s+/gm,
      /diagnose\s+(sys|debug|sniffer)/gm,
    ],
    certifications: ['NSE4', 'NSE5', 'NSE6', 'NSE7', 'NSE8'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: [
        'Preserve FortiOS CLI syntax exactly',
        'Include policy ID references',
        'Highlight Security Fabric integration points',
      ],
    },
  },

  paloalto: {
    id: 'paloalto',
    name: 'Palo Alto Networks',
    logo: '🟠',
    color: '#FA582D',
    keywords: [
      'palo alto', 'pan-os', 'panorama', 'prisma', 'cortex',
      'pcnsa', 'pcnse', 'pccsa', 'pcsae', 'xdr', 'xsoar',
      'app-id', 'content-id', 'user-id', 'wildfire', 'globalprotect',
      'zone-based', 'security profile', 'threat prevention',
    ],
    cliPatterns: [
      /^[a-z0-9@_-]+>\s*/gm,
      /^[a-z0-9@_-]+#\s*/gm,
      /set\s+(deviceconfig|network|rulebase)/gm,
      /show\s+(system|running|session)/gm,
      /request\s+(license|system|content)/gm,
    ],
    certifications: ['PCNSA', 'PCNSE', 'PCSAE', 'PCCSA'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: [
        'Preserve PAN-OS CLI syntax exactly',
        'Include commit workflow steps',
        'Highlight App-ID and Content-ID behaviors',
      ],
    },
  },

  juniper: {
    id: 'juniper',
    name: 'Juniper Networks',
    logo: '🟢',
    color: '#84B135',
    keywords: [
      'juniper', 'junos', 'srx', 'ex', 'mx', 'qfx', 'ptx',
      'jncia', 'jncis', 'jncip', 'jncie', 'mist', 'apstra',
      'routing-instance', 'policy-options', 'firewall filter',
    ],
    cliPatterns: [
      /^[a-z0-9@_-]+>\s*/gm,
      /^[a-z0-9@_-]+#\s*/gm,
      /^\[edit[^\]]*\]/gm,
      /set\s+(interfaces|protocols|routing-options|security)/gm,
      /show\s+(route|interfaces|configuration)/gm,
      /commit\s*(check|confirmed)?/gm,
    ],
    certifications: ['JNCIA', 'JNCIS', 'JNCIP', 'JNCIE'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: [
        'Preserve Junos CLI syntax exactly',
        'Include hierarchy context [edit]',
        'Highlight commit model differences from Cisco',
      ],
    },
  },

  oracle: {
    id: 'oracle',
    name: 'Oracle',
    logo: '🔴',
    color: '#F80000',
    keywords: [
      'oracle', 'oci', 'oracle cloud', 'oracle database', 'mysql',
      'pl/sql', 'sql*plus', 'rman', 'data guard', 'rac', 'asm',
      'weblogic', 'fusion', 'oracle linux', 'exadata', 'autonomous',
      'oca', 'ocp', 'ocm', 'oracle certified',
    ],
    cliPatterns: [
      /SQL>\s*/gm,
      /RMAN>\s*/gm,
      /^\$\s*sqlplus\s+/gm,
      /SELECT\s+.+\s+FROM/gim,
      /CREATE\s+(TABLE|INDEX|VIEW|PROCEDURE)/gim,
    ],
    certifications: ['OCA', 'OCP', 'OCM'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'reference',
      specialInstructions: [
        'Preserve SQL and PL/SQL syntax exactly',
        'Include version-specific features',
        'Highlight licensing considerations',
      ],
    },
  },

  generic: {
    id: 'generic',
    name: 'General Document',
    logo: '📄',
    color: '#6B7280',
    keywords: [],
    cliPatterns: [],
    certifications: [],
    aiRules: {
      preserveCliCommands: false,
      preserveConfigBlocks: false,
      useStrictGrounding: true,
      allowExternalKnowledge: true,
      technicalDepth: 'intermediate',
      outputFormat: 'study-notes',
      specialInstructions: [
        'Organize content clearly',
        'Highlight key concepts',
        'Provide practical examples',
      ],
    },
  },
};

// ============================================
// VENDOR DETECTION ENGINE
// ============================================

export class VendorDetector {
  private static instance: VendorDetector;

  private constructor() {}

  static getInstance(): VendorDetector {
    if (!VendorDetector.instance) {
      VendorDetector.instance = new VendorDetector();
    }
    return VendorDetector.instance;
  }

  /**
   * Detect vendor from document content
   */
  detect(text: string, fileName?: string): VendorDetectionResult {
    const lowerText = text.toLowerCase();
    const lowerFileName = fileName?.toLowerCase() || '';
    
    const scores: { vendorId: VendorId; score: number; keywords: string[]; patterns: string[]; cert?: string }[] = [];

    // Score each vendor
    for (const [vendorId, config] of Object.entries(VENDOR_CONFIGS)) {
      if (vendorId === 'generic') continue;

      let score = 0;
      const matchedKeywords: string[] = [];
      const matchedPatterns: string[] = [];
      let certDetected: string | undefined;

      // Check keywords (weight by specificity)
      for (const keyword of config.keywords) {
        const keywordLower = keyword.toLowerCase();
        if (lowerText.includes(keywordLower) || lowerFileName.includes(keywordLower)) {
          matchedKeywords.push(keyword);
          // Longer keywords are more specific = higher score
          score += keyword.length > 6 ? 3 : keyword.length > 3 ? 2 : 1;
        }
      }

      // Check CLI patterns (high weight)
      for (const pattern of config.cliPatterns) {
        const matches = text.match(pattern);
        if (matches && matches.length > 0) {
          matchedPatterns.push(pattern.source.substring(0, 30) + '...');
          score += matches.length * 5; // CLI patterns are strong indicators
        }
      }

      // Check certifications (very high weight)
      for (const cert of config.certifications) {
        const certPattern = new RegExp(`\\b${cert.replace(/[+]/g, '\\+')}\\b`, 'gi');
        if (certPattern.test(text) || certPattern.test(lowerFileName)) {
          certDetected = cert;
          score += 20; // Certification mention is a strong indicator
        }
      }

      if (score > 0) {
        scores.push({
          vendorId: vendorId as VendorId,
          score,
          keywords: matchedKeywords,
          patterns: matchedPatterns,
          cert: certDetected,
        });
      }
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Return top match or generic
    if (scores.length > 0 && scores[0].score >= 5) {
      const top = scores[0];
      const config = VENDOR_CONFIGS[top.vendorId];
      const maxPossibleScore = config.keywords.length * 3 + 50; // Approximate max
      const confidence = Math.min(top.score / maxPossibleScore, 1);

      return {
        detected: true,
        vendorId: top.vendorId,
        vendorName: config.name,
        confidence,
        matchedKeywords: top.keywords.slice(0, 15),
        matchedPatterns: top.patterns.slice(0, 5),
        certificationDetected: top.cert,
        logo: config.logo,
        color: config.color,
      };
    }

    // Default to generic
    return {
      detected: false,
      vendorId: 'generic',
      vendorName: 'General Document',
      confidence: 0,
      matchedKeywords: [],
      matchedPatterns: [],
      logo: VENDOR_CONFIGS.generic.logo,
      color: VENDOR_CONFIGS.generic.color,
    };
  }

  /**
   * Get vendor configuration by ID
   */
  getVendorConfig(vendorId: VendorId): VendorConfig {
    return VENDOR_CONFIGS[vendorId] || VENDOR_CONFIGS.generic;
  }

  /**
   * Get AI rules for a vendor
   */
  getAIRules(vendorId: VendorId): VendorAIRules {
    return VENDOR_CONFIGS[vendorId]?.aiRules || VENDOR_CONFIGS.generic.aiRules;
  }

  /**
   * Get all supported vendors
   */
  getSupportedVendors(): { id: VendorId; name: string; logo: string }[] {
    return Object.entries(VENDOR_CONFIGS)
      .filter(([id]) => id !== 'generic')
      .map(([id, config]) => ({
        id: id as VendorId,
        name: config.name,
        logo: config.logo,
      }));
  }
}

// Export singleton instance
export const vendorDetector = VendorDetector.getInstance();
