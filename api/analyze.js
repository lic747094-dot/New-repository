export default async function handler(req, res) {
  // 跨域配置（和原来一模一样，完全不动）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 从前端拿到图片（和原来逻辑一样）
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: '缺少图片数据' });
    }

    // ====================== 百度云部分（已填好你的 Key） ======================
    const API_KEY = "GCtJ5mFkdrHknQQPXGk2x7tF";
    const SECRET_KEY = "NqqGY0jqZKjs3oTjEuD14WZtKT8VZRlj";

    // 1. 获取 Access Token
    const tokenRes = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${API_KEY}&client_secret=${SECRET_KEY}`
    );
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return res.status(401).json({ error: '百度云鉴权失败', detail: tokenData });
    }

    // 2. 调用通用物体识别接口
    const apiUrl = `https://aip.baidubce.com/rest/2.0/image-classify/v2/general?access_token=${accessToken}`;
    const baiduRes = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `image=${encodeURIComponent(image)}`
    });

    const result = await baiduRes.json();

    // 3. 保持和 Claude 一样的返回格式，前端不用改任何代码
    return res.status(200).json({
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    });
    // ========================================================================

  } catch (error) {
    console.error('分析错误:', error);
    return res.status(500).json({ error: '图片分析失败' });
  }
}
