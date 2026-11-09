const { supabaseClient } = require('../lib/db');
module.exports=async(req,res)=>
  res.setHeader('Cache-Control', 'no-store');{try{const sb=supabaseClient(); const [p,a]=await Promise.all([sb.from('participants').select('id',{count:'exact',head:true}),sb.from('activities').select('id',{count:'exact',head:true})]); if(p.error)throw p.error;if(a.error)throw a.error;res.status(200).json({ok:true,service:'error404-debugger',database:'supabase',participants:p.count||0,activities:a.count||0})}catch(e){res.status(500).json({ok:false,error:e.message||String(e)})}};
