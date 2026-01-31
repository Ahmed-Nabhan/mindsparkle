const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

(async () => {
  const { data, error } = await supabase
    .from('documents')
    .select('id, title, content, extracted_text')
    .order('created_at', { ascending: false })
    .limit(3);
    
  if (error) { 
    console.log('Error:', error); 
    return; 
  }
  
  console.log('Documents in database:');
  data.forEach(d => {
    console.log('---');
    console.log('ID:', d.id);
    console.log('Title:', d.title);
    console.log('content length:', d.content?.length || 0);
    console.log('extracted_text length:', d.extracted_text?.length || 0);
    if (d.content) {
      console.log('content preview:', d.content.substring(0, 100));
    }
  });
})();
