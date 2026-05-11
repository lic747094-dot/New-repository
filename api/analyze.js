export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: '缺少图片数据' });

    const GEMINI_KEY = "AIzaSyBJiWbv4ijTZvj_J_Ask89YdvsP2vxQFww";

    const prompt = `你是一位大学数学教授，专门处理重积分题目。请识别图片中的重积分题目，严格按以下JSON格式返回（不要任何其他文字，不要markdown格式，直接输出JSON）：
{"label":"题目简短描述","integral_type":"double或triple","expression":"被积函数（用^表示幂，sqrt()表示根号，普通文本格式）","variables":["变量列表"],"bounds":{"outer":{"var":"最外层变量","lower":"下限","upper":"上限"},"middle":{"var":"中层变量仅三重积分填写，否则省略此字段","lower":"下限","upper":"上限"},"inner":{"var":"最内层变量","lower":"下限","upper":"上限"}},"region_description":"用中文详细描述积分区域几何形状和特征","coordinate_system":"cartesian或polar或cylindrical或spherical","result_hint":"如能算出结果写'= 值'否则写空字符串","steps":[{"t":"步骤标题","c":"步骤详细说明"}]}
注意：steps包含5-6个完整解题步骤；对于二重积分bounds只需outer和inner，不要middle字段；expression用普通文本如x^2+y^2，不要LaTeX。`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inline_data: {
                  mime_type: 'image/jpeg',
                  data: image
                }
              },
              { text: prompt }
            ]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2000
          }
        })
      }
    );

    if (!geminiRes.ok) {
      const errData = await geminiRes.json();
      throw new Error(errData.error?.message || 'Gemini API 请求失败 ' + geminiRes.status);
    }

    const geminiData = await geminiRes.json();
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return res.status(200).json({
      content: [{ type: 'text', text: JSON.stringify(parsed) }]
    });

  } catch (error) {
    console.error('分析错误:', error);
    return res.status(500).json({ error: '识别失败: ' + error.message });
  }
}
