import { supabase } from './supabase';

export type DocumentOutputStatus = 'queued' | 'processing' | 'completed' | 'failed';

export type DocumentOutputRow = {
  id: string;
  document_id: string;
  output_type: string;
  status: DocumentOutputStatus;
  input_snapshot: any;
  content: any;
  created_at: string;
  updated_at: string;
};

function formatFunctionInvokeError(err: any): string {
  if (!err) return 'Edge Function error';

  const message = String(err?.message || 'Edge Function error');
  const status = err?.context?.status ?? err?.status;
  const body = err?.context?.body ?? err?.context?.response ?? err?.details;

  let bodyText: string | null = null;
  if (typeof body === 'string') {
    bodyText = body;
  } else if (body != null) {
    try {
      bodyText = JSON.stringify(body);
    } catch {
      bodyText = String(body);
    }
  }

  const parts = [message];
  if (status) parts.push(`(HTTP ${String(status)})`);
  if (bodyText) parts.push(bodyText);

  return parts.join(' ');
}

export async function requestDeepExplain(documentId: string): Promise<{ outputId: string; jobId?: string }> {
  const { data, error } = await supabase.functions.invoke('generate-output', {
    body: {
      documentId,
      outputType: 'deep_explain',
      options: {},
    },
  });

  if (error) {
    throw new Error(formatFunctionInvokeError(error));
  }
  if (!data?.outputId) throw new Error('generate-output did not return outputId');
  return { outputId: data.outputId, jobId: data.jobId };
}

export async function getDeepExplainOutput(documentId: string): Promise<DocumentOutputRow | null> {
  const { data, error } = await supabase
    .from('document_outputs')
    .select('*')
    .eq('document_id', documentId)
    .eq('output_type', 'deep_explain')
    .single();

  if (error) return null;
  return data as any;
}

export function subscribeToDeepExplainOutput(
  documentId: string,
  onUpdate: (row: DocumentOutputRow) => void
): () => void {
  const channel = supabase
    .channel(`document_outputs:deep_explain:${documentId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'document_outputs',
        filter: `document_id=eq.${documentId}`,
      },
      (payload) => {
        const row = (payload.new || payload.old) as any;
        if (!row) return;
        if (row.output_type !== 'deep_explain') return;
        onUpdate(row as DocumentOutputRow);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function createDocAssetsSignedUrl(imagePath: string, seconds = 1800): Promise<string | null> {
  const raw = String(imagePath || '').trim();
  if (!raw) return null;

  const path = raw.startsWith('doc_assets/') ? raw.slice('doc_assets/'.length) : raw;
  const { data, error } = await supabase.storage.from('doc_assets').createSignedUrl(path, seconds);
  if (error) return null;
  return data?.signedUrl || null;
}
