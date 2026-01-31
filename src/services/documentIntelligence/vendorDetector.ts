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
    // PNG (works with React Native <Image>). If you prefer a local asset later, replace with require(...).
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Cisco_logo_blue_2016.svg/200px-Cisco_logo_blue_2016.svg.png',
    color: '#049FD9',
    keywords: [
      'cisco', 'ios', 'ios-xe', 'ios-xr', 'nx-os', 'asa', 'firepower', 'fmc',
      'ccna', 'ccnp', 'ccie', 'ccent', 'devnet', 'cyberops',
      'ccna security', 'cisco press', 'ciscopress', 'ciscopress.com', 'portable command guide',
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
    certifications: ['CCNA', 'CCNP', 'CCIE', 'CCENT', 'DevNet', 'CyberOps', '210-260'],
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

  // ============================================
  // NEW VENDORS - Cloud & Enterprise
  // ============================================

  ibm: {
    id: 'ibm',
    name: 'IBM',
    logo: '🔵',
    color: '#0F62FE',
    keywords: [
      'ibm', 'ibm cloud', 'watson', 'db2', 'websphere', 'mq',
      'ibm spectrum', 'power systems', 'aix', 'z/os', 'mainframe',
      'cics', 'cobol', 'jcl', 'tso', 'ispf', 'racf',
      'cloud pak', 'redhat openshift', 'ibm certified',
    ],
    cliPatterns: [
      /ibmcloud\s+[a-z]+/gm,
      /db2\s+[a-z]+/gm,
      /\/\/[A-Z0-9]+\s+JOB/gm, // JCL
    ],
    certifications: ['IBM Certified', 'IBM Cloud', 'Db2'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'reference',
      specialInstructions: ['Preserve mainframe syntax exactly'],
    },
  },

  salesforce: {
    id: 'salesforce',
    name: 'Salesforce',
    logo: '☁️',
    color: '#00A1E0',
    keywords: [
      'salesforce', 'sfdc', 'apex', 'soql', 'sosl', 'visualforce',
      'lightning', 'lwc', 'aura', 'trailhead', 'force.com',
      'sales cloud', 'service cloud', 'marketing cloud', 'pardot',
      'cpq', 'einstein', 'mulesoft', 'tableau crm',
      'admin', 'platform developer', 'architect',
    ],
    cliPatterns: [
      /SELECT\s+.+\s+FROM\s+[A-Za-z_]+__c/gim, // SOQL
      /sfdx\s+[a-z:]+/gm,
      /sf\s+[a-z]+/gm,
    ],
    certifications: ['Admin', 'Platform Developer', 'Architect', 'Consultant'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve Apex and SOQL syntax exactly'],
    },
  },

  sap: {
    id: 'sap',
    name: 'SAP',
    logo: '🟦',
    color: '#0FAAFF',
    keywords: [
      'sap', 's/4hana', 'hana', 'abap', 'fiori', 'netweaver',
      'sap erp', 'sap bw', 'sap bo', 'successfactors', 'ariba',
      'concur', 'sap cloud platform', 'sap btp', 'integration suite',
      'sap certified', 'functional consultant', 'technical consultant',
    ],
    cliPatterns: [
      /REPORT\s+[A-Z0-9_]+/gm, // ABAP
      /SELECT\s+.+\s+INTO\s+TABLE/gim,
      /FORM\s+[a-z_]+/gm,
    ],
    certifications: ['SAP Certified', 'Associate', 'Professional', 'Specialist'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'reference',
      specialInstructions: ['Preserve ABAP syntax exactly'],
    },
  },

  // ============================================
  // NEW VENDORS - Containers & DevOps
  // ============================================

  docker: {
    id: 'docker',
    name: 'Docker',
    logo: '🐳',
    color: '#2496ED',
    keywords: [
      'docker', 'dockerfile', 'docker-compose', 'container', 'image',
      'docker hub', 'docker swarm', 'docker desktop', 'containerd',
      'docker build', 'docker run', 'docker pull', 'docker push',
      'multi-stage', 'layer', 'volume', 'network', 'bridge',
    ],
    cliPatterns: [
      /docker\s+(build|run|pull|push|exec|ps|images)/gm,
      /docker-compose\s+(up|down|build|logs)/gm,
      /FROM\s+[a-z0-9./-]+:[a-z0-9.-]+/gim, // Dockerfile
      /COPY|ADD|RUN|CMD|ENTRYPOINT|EXPOSE|ENV|WORKDIR/gm,
    ],
    certifications: ['DCA', 'Docker Certified Associate'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'reference',
      specialInstructions: ['Preserve Dockerfile syntax exactly'],
    },
  },

  kubernetes: {
    id: 'kubernetes',
    name: 'Kubernetes',
    logo: '☸️',
    color: '#326CE5',
    keywords: [
      'kubernetes', 'k8s', 'kubectl', 'pod', 'deployment', 'service',
      'ingress', 'configmap', 'secret', 'pvc', 'storageclass',
      'helm', 'kustomize', 'operator', 'crd', 'istio', 'linkerd',
      'cka', 'ckad', 'cks', 'kcna', 'kubeadm', 'etcd',
      'namespace', 'node', 'cluster', 'control plane', 'kubelet',
    ],
    cliPatterns: [
      /kubectl\s+(get|apply|delete|describe|logs|exec)/gm,
      /helm\s+(install|upgrade|list|repo)/gm,
      /apiVersion:\s*[a-z0-9/]+/gm, // YAML manifests
      /kind:\s*(Pod|Deployment|Service|Ingress|ConfigMap)/gm,
    ],
    certifications: ['CKA', 'CKAD', 'CKS', 'KCNA'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve YAML manifests exactly', 'Include API versions'],
    },
  },

  hashicorp: {
    id: 'hashicorp',
    name: 'HashiCorp',
    logo: '⬛',
    color: '#000000',
    keywords: [
      'hashicorp', 'terraform', 'vault', 'consul', 'nomad', 'packer',
      'vagrant', 'boundary', 'waypoint', 'hcl', 'infrastructure as code',
      'iac', 'state file', 'provider', 'module', 'workspace',
      'terraform associate', 'terraform professional',
    ],
    cliPatterns: [
      /terraform\s+(init|plan|apply|destroy|state)/gm,
      /vault\s+(read|write|login|secrets)/gm,
      /consul\s+(agent|members|services)/gm,
      /resource\s+"[a-z_]+"\s+"[a-z_]+"/gm, // HCL
      /variable\s+"[a-z_]+"/gm,
    ],
    certifications: ['Terraform Associate', 'Vault Associate', 'Consul Associate'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve HCL/Terraform syntax exactly'],
    },
  },

  // ============================================
  // NEW VENDORS - Security
  // ============================================

  checkpoint: {
    id: 'checkpoint',
    name: 'Check Point',
    logo: '🛡️',
    color: '#E21836',
    keywords: [
      'check point', 'checkpoint', 'gaia', 'smartconsole', 'smartcenter',
      'ccsa', 'ccse', 'ccsm', 'firewall', 'vpn', 'ips', 'threat prevention',
      'harmony', 'cloudguard', 'quantum', 'infinity', 'sandblast',
    ],
    cliPatterns: [
      /cpconfig/gm,
      /fw\s+(stat|ctl|tab)/gm,
      /clish/gm,
      /set\s+(interface|static-route|hostname)/gm,
    ],
    certifications: ['CCSA', 'CCSE', 'CCSM'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve Gaia CLI syntax exactly'],
    },
  },

  crowdstrike: {
    id: 'crowdstrike',
    name: 'CrowdStrike',
    logo: '🦅',
    color: '#FC0000',
    keywords: [
      'crowdstrike', 'falcon', 'edr', 'xdr', 'threat intelligence',
      'endpoint protection', 'threat hunting', 'overwatch',
      'falcon insight', 'falcon prevent', 'falcon discover',
      'ccfa', 'ccfr', 'ccfh', 'crowdstrike certified',
    ],
    cliPatterns: [
      /falconctl/gm,
      /\/(opt|var)\/CrowdStrike/gm,
    ],
    certifications: ['CCFA', 'CCFR', 'CCFH'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Focus on detection and response procedures'],
    },
  },

  splunk: {
    id: 'splunk',
    name: 'Splunk',
    logo: '📊',
    color: '#65A637',
    keywords: [
      'splunk', 'spl', 'splunk enterprise', 'splunk cloud', 'siem',
      'search processing language', 'index', 'sourcetype', 'forwarder',
      'splunk core certified', 'splunk enterprise certified',
      'phantom', 'soar', 'itsi', 'observability',
    ],
    cliPatterns: [
      /index=[a-z_]+/gm,
      /sourcetype=[a-z_]+/gm,
      /\|\s*(stats|table|eval|rex|where|search)/gm,
      /splunk\s+(start|stop|restart|status)/gm,
    ],
    certifications: ['Core Certified User', 'Core Certified Power User', 'Enterprise Admin'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve SPL queries exactly'],
    },
  },

  isc2: {
    id: 'isc2',
    name: 'ISC2',
    logo: '🔐',
    color: '#006B54',
    keywords: [
      'isc2', 'cissp', 'ccsp', 'sscp', 'csslp', 'cgrc', 'issap', 'issep', 'issmp',
      'security domains', 'common body of knowledge', 'cbk',
      'asset security', 'security architecture', 'identity and access',
      'security assessment', 'security operations', 'software security',
    ],
    cliPatterns: [],
    certifications: ['CISSP', 'CCSP', 'SSCP', 'CSSLP', 'CGRC'],
    aiRules: {
      preserveCliCommands: false,
      preserveConfigBlocks: false,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Focus on security concepts and best practices', 'Use ISC2 terminology'],
    },
  },

  isaca: {
    id: 'isaca',
    name: 'ISACA',
    logo: '📋',
    color: '#003366',
    keywords: [
      'isaca', 'cisa', 'cism', 'crisc', 'cgeit', 'cdpse',
      'cobit', 'it governance', 'risk management', 'audit',
      'information security', 'it audit', 'control objectives',
    ],
    cliPatterns: [],
    certifications: ['CISA', 'CISM', 'CRISC', 'CGEIT', 'CDPSE'],
    aiRules: {
      preserveCliCommands: false,
      preserveConfigBlocks: false,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Focus on governance and audit frameworks', 'Use ISACA terminology'],
    },
  },

  'ec-council': {
    id: 'ec-council',
    name: 'EC-Council',
    logo: '💀',
    color: '#FF0000',
    keywords: [
      'ec-council', 'ceh', 'certified ethical hacker', 'ecsa', 'lpt',
      'chfi', 'cnda', 'ensa', 'ecih', 'ctia',
      'penetration testing', 'ethical hacking', 'vulnerability assessment',
      'footprinting', 'scanning', 'enumeration', 'exploitation',
    ],
    cliPatterns: [
      /nmap\s+-[a-zA-Z]+/gm,
      /metasploit|msfconsole/gm,
      /burpsuite|sqlmap|nikto|dirb/gm,
    ],
    certifications: ['CEH', 'ECSA', 'LPT', 'CHFI', 'CTIA'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve hacking tool syntax', 'Follow ethical guidelines'],
    },
  },

  // ============================================
  // NEW VENDORS - Networking
  // ============================================

  arista: {
    id: 'arista',
    name: 'Arista Networks',
    logo: '🌿',
    color: '#4C9ACD',
    keywords: [
      // Keep Arista-specific terms only; avoid generic networking tech keywords that appear in many vendors' docs.
      'arista', 'cloudvision', 'danz',
      'ace-l', 'ace-a', 'ace-e', 'arista certified',
      'mlag', 'varp', 'tap aggregation', 'network telemetry',
    ],
    cliPatterns: [
      /^[a-z0-9-]+[#>]\s*/gm,
      /show\s+(interfaces?|ip|vlan|mlag|vxlan)/gm,
      /configure(\s+terminal)?/gm,
    ],
    // NOTE: "ACE" is highly ambiguous in networking (often "Access Control Entry").
    // Keep the Arista-specific cert variants only.
    certifications: ['ACE-L', 'ACE-A', 'ACE-E'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve EOS CLI syntax exactly'],
    },
  },

  f5: {
    id: 'f5',
    name: 'F5 Networks',
    logo: '🔴',
    color: '#E4002B',
    keywords: [
      'f5', 'big-ip', 'ltm', 'gtm', 'asm', 'apm', 'afm',
      'irule', 'tcl', 'virtual server', 'pool', 'node',
      'ssl offload', 'load balancing', 'waf', 'f5 certified',
      'f5-ca', '201', '301', '302',
    ],
    cliPatterns: [
      /tmsh/gm,
      /ltm\s+(virtual|pool|node|monitor)/gm,
      /when\s+(CLIENT_ACCEPTED|HTTP_REQUEST|HTTP_RESPONSE)/gm, // iRule
    ],
    certifications: ['F5-CA', '201', '301', '302'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve TMSH and iRule syntax exactly'],
    },
  },

  netapp: {
    id: 'netapp',
    name: 'NetApp',
    logo: '💾',
    color: '#0067C5',
    keywords: [
      'netapp', 'ontap', 'data ontap', 'clustered data ontap',
      'filer', 'storage', 'san', 'nas', 'snapmirror', 'snapvault',
      'aggregate', 'volume', 'lun', 'qtree', 'cifs', 'nfs',
      'nca', 'ncda', 'ncsie', 'netapp certified',
    ],
    cliPatterns: [
      /::>\s*/gm, // ONTAP CLI prompt
      /volume\s+(create|show|modify)/gm,
      /aggregate\s+(create|show)/gm,
      /snapmirror\s+(initialize|update|show)/gm,
    ],
    certifications: ['NCA', 'NCDA', 'NCSIE'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'reference',
      specialInstructions: ['Preserve ONTAP CLI syntax exactly'],
    },
  },

  aruba: {
    id: 'aruba',
    name: 'Aruba Networks',
    logo: '🟠',
    color: '#FF8300',
    keywords: [
      'aruba', 'arubaos', 'clearpass', 'central', 'airwave',
      'controller', 'instant', 'access point', 'wireless',
      'acma', 'acmp', 'acdp', 'accp', 'aruba certified',
      'mobility master', 'virtual controller', 'wlan',
    ],
    cliPatterns: [
      /\(aruba\)\s*[#>]/gm,
      /show\s+(ap|wlan|aaa|user)/gm,
      /wlan\s+(ssid-profile|access-rule)/gm,
    ],
    certifications: ['ACMA', 'ACMP', 'ACDP', 'ACCP'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve ArubaOS CLI syntax exactly'],
    },
  },

  // ============================================
  // NEW VENDORS - Data & Analytics
  // ============================================

  mongodb: {
    id: 'mongodb',
    name: 'MongoDB',
    logo: '🍃',
    color: '#00ED64',
    keywords: [
      'mongodb', 'mongo', 'nosql', 'document database', 'atlas',
      'replica set', 'sharding', 'aggregation', 'mongoose',
      'bson', 'collection', 'document', 'index', 'compass',
      'mongodb certified', 'dba', 'developer',
    ],
    cliPatterns: [
      /mongosh?>\s*/gm,
      /db\.[a-z]+\.(find|insert|update|delete|aggregate)/gm,
      /use\s+[a-z_]+/gm,
    ],
    certifications: ['MongoDB Certified DBA', 'MongoDB Certified Developer'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'reference',
      specialInstructions: ['Preserve MongoDB query syntax exactly'],
    },
  },

  snowflake: {
    id: 'snowflake',
    name: 'Snowflake',
    logo: '❄️',
    color: '#29B5E8',
    keywords: [
      'snowflake', 'data warehouse', 'data cloud', 'snowpark',
      'virtual warehouse', 'database', 'schema', 'stage',
      'snowpipe', 'streams', 'tasks', 'time travel',
      'snowflake certified', 'snowpro', 'core', 'advanced',
    ],
    cliPatterns: [
      /CREATE\s+(OR\s+REPLACE\s+)?(DATABASE|SCHEMA|TABLE|VIEW|WAREHOUSE)/gim,
      /COPY\s+INTO/gim,
      /PUT\s+file:\/\//gim,
    ],
    certifications: ['SnowPro Core', 'SnowPro Advanced'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve Snowflake SQL syntax exactly'],
    },
  },

  databricks: {
    id: 'databricks',
    name: 'Databricks',
    logo: '🔶',
    color: '#FF3621',
    keywords: [
      'databricks', 'spark', 'delta lake', 'mlflow', 'lakehouse',
      'notebook', 'cluster', 'workspace', 'unity catalog',
      'databricks certified', 'data engineer', 'data analyst',
      'pyspark', 'scala', 'sql analytics',
    ],
    cliPatterns: [
      /spark\.(read|write|sql|createDataFrame)/gm,
      /dbutils\.(fs|secrets|widgets)/gm,
      /%sql|%python|%scala/gm,
    ],
    certifications: ['Data Engineer Associate', 'Data Engineer Professional', 'ML Associate'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve Spark/PySpark syntax exactly'],
    },
  },

  servicenow: {
    id: 'servicenow',
    name: 'ServiceNow',
    logo: '🟢',
    color: '#81B5A1',
    keywords: [
      'servicenow', 'snow', 'itsm', 'itom', 'itbm', 'hrsd',
      'glide', 'scripting', 'flow designer', 'integration hub',
      'csa', 'cad', 'cis', 'servicenow certified',
      'incident', 'change', 'problem', 'cmdb', 'discovery',
    ],
    cliPatterns: [
      /GlideRecord\s*\(/gm,
      /gs\.(info|error|log|addInfoMessage)/gm,
      /current\.[a-z_]+/gm,
    ],
    certifications: ['CSA', 'CAD', 'CIS-ITSM', 'CIS-ITOM'],
    aiRules: {
      preserveCliCommands: true,
      preserveConfigBlocks: true,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'advanced',
      outputFormat: 'exam-prep',
      specialInstructions: ['Preserve GlideRecord and scripting syntax exactly'],
    },
  },

  // ============================================
  // NEW VENDORS - General IT Frameworks
  // ============================================

  itil: {
    id: 'itil',
    name: 'ITIL',
    logo: '📘',
    color: '#5C2D91',
    keywords: [
      'itil', 'itil 4', 'itil v3', 'itsm', 'service management',
      'incident management', 'change management', 'problem management',
      'service desk', 'sla', 'service level', 'continual improvement',
      'axelos', 'foundation', 'practitioner', 'managing professional',
      'service value system', 'svs', 'service value chain',
    ],
    cliPatterns: [],
    certifications: ['ITIL Foundation', 'ITIL MP', 'ITIL SL'],
    aiRules: {
      preserveCliCommands: false,
      preserveConfigBlocks: false,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'intermediate',
      outputFormat: 'exam-prep',
      specialInstructions: ['Use official ITIL terminology', 'Reference ITIL 4 practices'],
    },
  },

  pmi: {
    id: 'pmi',
    name: 'PMI',
    logo: '📊',
    color: '#1B365D',
    keywords: [
      'pmi', 'pmp', 'capm', 'pgmp', 'pmi-acp', 'pmi-rmp',
      'pmbok', 'project management', 'agile', 'waterfall',
      'scope', 'schedule', 'cost', 'quality', 'risk',
      'stakeholder', 'procurement', 'communications',
      'predictive', 'adaptive', 'hybrid',
    ],
    cliPatterns: [],
    certifications: ['PMP', 'CAPM', 'PgMP', 'PMI-ACP', 'PMI-RMP'],
    aiRules: {
      preserveCliCommands: false,
      preserveConfigBlocks: false,
      useStrictGrounding: true,
      allowExternalKnowledge: false,
      technicalDepth: 'intermediate',
      outputFormat: 'exam-prep',
      specialInstructions: ['Use PMI terminology', 'Reference PMBOK Guide'],
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

    const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Short keywords like "ad" or "ace" create massive false positives with substring matching.
    // Use token-style matching for short, single-token keywords.
    const matchesKeyword = (keyword: string): boolean => {
      const kw = keyword.toLowerCase();
      const isSingleToken = !/\s/.test(kw);
      const isShort = kw.length <= 4;

      if (isSingleToken && isShort) {
        const escaped = escapeRegExp(kw);
        const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
        return re.test(lowerText) || re.test(lowerFileName);
      }

      return lowerText.includes(kw) || lowerFileName.includes(kw);
    };

    // High-precision Cisco override: Cisco Press / CCNA books and official Cisco training
    // can contain ambiguous terms like "ACE" (Access Control Entry) that would otherwise
    // mislead keyword-based scoring for other networking vendors.
    const strongCiscoSignals = [
      'cisco press',
      'ciscopress',
      'ciscopress.com',
      'netacad',
      'networking academy',
      'packet tracer',
      'ccna',
      'ccnp',
      'ccie',
      '210-260',
    ];

    const matchedCiscoSignals = strongCiscoSignals.filter((s) => matchesKeyword(s));
    if (matchedCiscoSignals.length > 0) {
      const config = VENDOR_CONFIGS.cisco;
      return {
        detected: true,
        vendorId: 'cisco',
        vendorName: config.name,
        confidence: 0.95,
        matchedKeywords: matchedCiscoSignals.slice(0, 15),
        matchedPatterns: [],
        certificationDetected: undefined,
        logo: config.logo,
        color: config.color,
      };
    }
    
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
        if (matchesKeyword(keyword)) {
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
