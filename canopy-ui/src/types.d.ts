export {};

export interface PolicyObjectRef {
  id?: number;
  name: string;
  object_type: string;
}

declare global {
  interface Window {
    electron: {
      getBackendAuth: () => Promise<{ url: string; token: string }>;
      onTriggerHelp: (callback: () => void) => void;
      relaunchApp: () => void;
      exportLogs: () => Promise<{ success: boolean; filePath?: string }>;
      isSafeStorageAvailable: () => Promise<boolean>;
      encryptString: (plainText: string) => Promise<string>;
      decryptString: (base64Str: string) => Promise<string>;
      promptBiometric: (reason: string) => Promise<boolean>;
      broadcastMutation: (targetType?: string) => void;
      onMutationDetected: (callback: (targetType?: string) => void) => void;
    };
  }

  interface PolicyRule {
    id: number;
    device_uuid: string;
    scope: string;
    rule_name: string;
    description?: string;
    disabled: number;
    action?: string;
    schedule_id?: number;

    // Shared Arrays
    source_zone: string[];
    destination_zone: string[];
    source_address: PolicyObjectRef[];
    destination_address: PolicyObjectRef[];
    service: PolicyObjectRef[];
    application: PolicyObjectRef[];
    tags: string[];

    // Security specific
    profile_type?: string;
    profile_group?: string;

    // NAT specific
    to_zone?: string;
    source_translation_type?: string;
    source_translation_address?: string;
    destination_translation_address?: string;
    destination_translation_port?: string;

    // QoS specific
    qos_class?: string;
    dscp_tos_marking?: string;

    // PBF specific
    forward_interface?: string;
    forward_next_hop?: string;
    monitor_profile?: string;

    // Decryption specific
    decryption_type?: string;
    decryption_profile?: string;

    // App Override specific
    protocol?: string;
    port?: string;

    // Additional fields dynamically added by UI
    origin?: string;
    match_status?: string;
  }
}