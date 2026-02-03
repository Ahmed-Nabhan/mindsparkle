-- Add additional feature flags defaults
INSERT INTO public.feature_flags (feature_name, enabled, settings)
VALUES
  ('file_upload', true, '{"max_size_mb": 50, "allowed_types": ["pdf", "docx", "xlsx", "pptx", "txt", "csv", "jpg", "jpeg", "png", "gif", "webp", "mp3", "mp4"]}'),
  ('document_generation', true, '{"formats": ["docx", "pdf", "xlsx", "pptx", "md"]}'),
  ('voice_input', true, NULL),
  ('suggested_prompts', true, NULL)
ON CONFLICT (feature_name) DO NOTHING;
