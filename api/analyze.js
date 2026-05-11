export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: '缺少图片数据' });

    // ── 1. 百度鉴权 ──────────────────────────────────────────
    const API_KEY    = "GCtJ5mFkdrHknQQPXGk2x7tF";
    const SECRET_KEY = "NqqGY0jqZKjs3oTjEuD14WZtKT8VZRlj";

    const tokenRes = await fetch(
      `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${API_KEY}&client_secret=${SECRET_KEY}`
    );
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) return res.status(401).json({ error: '百度云鉴权失败', detail: tokenData });

    // ── 2. 调用公式识别接口 ───────────────────────────────────
    const ocrRes = await fetch(
      `https://aip.baidubce.com/rest/2.0/ocr/v1/formula?access_token=${accessToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `image=${encodeURIComponent(image)}`
      }
    );
    const ocrData = await ocrRes.json();

    // 拼接识别出的 LaTeX
    let latex = '';
    if (ocrData.words_result && ocrData.words_result.length > 0) {
      latex = ocrData.words_result.map(r => r.words).join(' ');
    } else {
      return res.status(200).json({
        content: [{ type: 'text', text: JSON.stringify(buildFallback()) }]
      });
    }

    // ── 3. 解析 LaTeX → 结构化 JSON ──────────────────────────
    const parsed = parseIntegral(latex);

    return res.status(200).json({
      content: [{ type: 'text', text: JSON.stringify(parsed) }]
    });

  } catch (error) {
    console.error('分析错误:', error);
    return res.status(500).json({ error: '图片分析失败: ' + error.message });
  }
}

// ── LaTeX 解析器 ──────────────────────────────────────────────
function parseIntegral(latex) {
  const raw = latex.replace(/\s+/g, ' ').trim();

  // 判断几重积分
  const tripleMatch = raw.match(/\\iiint|\\int\\int\\int|∭/);
  const doubleMatch = raw.match(/\\iint|\\int\\int|∬/);
  const integralType = tripleMatch ? 'triple' : 'double';

  // 提取积分限（\int_{下}^{上}）
  const limitRegex = /\\int(?:_\{([^}]*)\})?\^?\{?([^}]*)\}?/g;
  const limits = [];
  let m;
  while ((m = limitRegex.exec(raw)) !== null) {
    limits.push({ lower: cleanExpr(m[1] || '0'), upper: cleanExpr(m[2] || '1') });
  }

  // 提取被积函数（去掉积分号和 d 变量部分）
  let expr = raw
    .replace(/\\iiint|\\iint|\\int/g, '')
    .replace(/\\int_\{[^}]*\}\^?\{[^}]*\}/g, '')
    .replace(/d[xyz θrφρ]/g, '')
    .replace(/\\,/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/\\{|}|{|}/g, '')
    .trim();
  expr = cleanExpr(expr) || 'f';

  // 判断坐标系
  const coordSystem = detectCoord(raw);

  // 构建 bounds
  const vars = integralType === 'triple'
    ? (coordSystem === 'spherical'   ? ['ρ','φ','θ']
       : coordSystem === 'cylindrical' ? ['r','θ','z']
       : ['x','y','z'])
    : (coordSystem === 'polar' ? ['r','θ'] : ['x','y']);

  const bounds = {};
  const outerIdx = 0, innerIdx = integralType === 'triple' ? 2 : 1, midIdx = 1;
  bounds.outer = { var: vars[0], lower: limits[outerIdx]?.lower || '0', upper: limits[outerIdx]?.upper || '1' };
  bounds.inner = { var: vars[integralType === 'triple' ? 2 : 1], lower: limits[innerIdx]?.lower || '0', upper: limits[innerIdx]?.upper || '1' };
  if (integralType === 'triple') {
    bounds.middle = { var: vars[1], lower: limits[midIdx]?.lower || '0', upper: limits[midIdx]?.upper || '1' };
  }

  // 区域描述
  const desc = buildDesc(bounds, coordSystem, integralType);

  // 解题步骤
  const steps = buildSteps(expr, bounds, coordSystem, integralType);

  return {
    label: `${integralType === 'triple' ? '三' : '二'}重积分识别结果`,
    integral_type: integralType,
    expression: expr,
    variables: integralType === 'triple' ? ['x','y','z'] : ['x','y'],
    bounds,
    region_description: desc,
    coordinate_system: coordSystem,
    result_hint: '',
    steps,
    _raw_latex: raw
  };
}

function cleanExpr(s) {
  if (!s) return '';
  return s
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^}]*)\}/g, 'sqrt($1)')
    .replace(/\\sqrt/g, 'sqrt')
    .replace(/\^([0-9])/g, '^$1')
    .replace(/\\pi/g, 'π')
    .replace(/\\infty/g, '∞')
    .replace(/\\cdot/g, '*')
    .replace(/\\times/g, '*')
    .replace(/[{}\\]/g, '')
    .trim();
}

function detectCoord(raw) {
  if (/r\s*d\s*r|polar|r\^2|r\s*\\,\s*dr/i.test(raw)) return 'polar';
  if (/\\rho|dρ|d\\rho|phi|\\phi|spherical/i.test(raw)) return 'spherical';
  if (/cylindrical|r\s*dz|dz.*dr/i.test(raw)) return 'cylindrical';
  return 'cartesian';
}

function buildDesc(bounds, coord, type) {
  const coordName = { cartesian:'直角坐标', polar:'极坐标', cylindrical:'柱坐标', spherical:'球坐标' }[coord];
  if (type === 'double') {
    return `采用${coordName}，积分区域由 ${bounds.outer.var} 从 ${bounds.outer.lower} 到 ${bounds.outer.upper}，${bounds.inner.var} 从 ${bounds.inner.lower} 到 ${bounds.inner.upper} 确定的区域。`;
  }
  return `采用${coordName}，积分区域由 ${bounds.outer.var}∈[${bounds.outer.lower}, ${bounds.outer.upper}]，${bounds.middle.var}∈[${bounds.middle.lower}, ${bounds.middle.upper}]，${bounds.inner.var}∈[${bounds.inner.lower}, ${bounds.inner.upper}] 围成的立体区域。`;
}

function buildSteps(expr, bounds, coord, type) {
  const coordName = { cartesian:'直角坐标系', polar:'极坐标', cylindrical:'柱坐标', spherical:'球坐标' }[coord];
  return [
    { t: '识别积分类型', c: `这是一个${type==='triple'?'三':'二'}重积分，被积函数为 f = ${expr}，采用${coordName}。` },
    { t: '确定积分区域', c: `外层变量 ${bounds.outer.var} 的范围：[${bounds.outer.lower}, ${bounds.outer.upper}]${bounds.middle ? `；中层变量 ${bounds.middle.var}：[${bounds.middle.lower}, ${bounds.middle.upper}]` : ''}；内层变量 ${bounds.inner.var}：[${bounds.inner.lower}, ${bounds.inner.upper}]。` },
    { t: '画出积分区域', c: '根据上述范围在坐标系中画出积分区域的草图，右侧3D图即为该区域的立体可视化。' },
    { t: '建立累次积分', c: `将${type==='triple'?'三':'二'}重积分化为累次积分，从内到外逐层计算。` },
    { t: '逐层计算', c: `先对内层变量 ${bounds.inner.var} 积分，再对${bounds.middle?`中层变量 ${bounds.middle.var}，最后对`:''}外层变量 ${bounds.outer.var} 积分。` },
    { t: '注意事项', c: '检查积分顺序是否正确，注意换元时 Jacobian 行列式（极坐标 r，球坐标 ρ²sinφ）不要遗漏。' }
  ];
}

function buildFallback() {
  return {
    label: '未能识别，请手动选择示例',
    integral_type: 'double', expression: 'f(x,y)',
    variables: ['x','y'],
    bounds: { outer:{var:'x',lower:'0',upper:'1'}, inner:{var:'y',lower:'0',upper:'1'} },
    region_description: '百度公式OCR未能识别图片中的公式，请确保图片清晰、公式完整。',
    coordinate_system: 'cartesian', result_hint: '', steps: [],
    _raw_latex: ''
  };
}
