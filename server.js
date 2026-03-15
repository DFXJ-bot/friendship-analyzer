require('dotenv').config();
const express = require('express');
const multer = require('multer');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

// 确保上传目录存在
const uploadPath = process.env.UPLOAD_PATH || './uploads';
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
}

// 文件上传配置
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB
  },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('只支持JPG、PNG、WEBP格式的图片'));
    }
  }
});

// 调用豆包大模型API
async function callDoubaoAPI(imagePaths) {
  const apiKey = process.env.ARK_API_KEY || '20412aa9-3ef1-4e3a-a363-f904b202266f';
  const modelId = process.env.ARK_MODEL_ID || 'ep-20260312180453-949sb';
  const apiUrl = process.env.ARK_API_URL || 'https://ark.cn-beijing.volces.com/api/v3/responses';

  // 构造system prompt
  const systemPrompt = "你是一个追求异性的高手，对于青春男女生的心理和外在表现，有非常强的洞察，也有一套很厉害的追求异性的技巧！擅长于输出简短但有效的分析和建议。";
  
  // 构造用户指令
  const userPrompt = `请分析这些朋友圈截图，帮我了解这个人的性格、兴趣爱好、生活方式，然后给出具体的交友建议。请用中文回复，格式清晰易懂。`;

  // 构造图片内容
  const imageContents = [];
  
  // 添加图片（使用base64编码）
  for (let i = 0; i < imagePaths.length; i++) {
    try {
      console.log(`正在处理图片 ${i+1}/${imagePaths.length}: ${imagePaths[i]}`);
      const imageBase64 = fs.readFileSync(imagePaths[i], { encoding: 'base64' });
      // 获取图片格式
      const ext = path.extname(imagePaths[i]).toLowerCase().replace('.', '');
      const mimeType = ext === 'jpg' ? 'jpeg' : ext;
      
      imageContents.push({
        "type": "input_image",
        "image_url": `data:image/${mimeType};base64,${imageBase64}`
      });
    } catch (err) {
      console.error(`读取图片失败: ${imagePaths[i]}`, err);
    }
  }

  // 添加用户指令
  imageContents.push({
    "type": "input_text",
    "text": userPrompt
  });

  // 正确的请求体格式
  const requestBody = {
    "model": modelId,
    "input": [
      {
        "role": "system",
        "content": [
          {
            "type": "input_text",
            "text": systemPrompt
          }
        ]
      },
      {
        "role": "user",
        "content": imageContents
      }
    ]
  };

  console.log('正在调用豆包API...');
  console.log('API地址:', apiUrl);
  console.log('模型ID:', modelId);
  console.log('图片数量:', imagePaths.length);

  try {
    const response = await axios.post(apiUrl, requestBody, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 120000 // 120秒超时
    });

    console.log('API响应状态:', response.status);
    
    // ========== 修复：正确解析响应文本 ==========
    let resultContent = '';

    if (response.data) {
      console.log('开始解析响应数据...');
      
      // 火山引擎的响应格式：从 output 中提取文本
      if (response.data.output) {
        console.log('找到output字段');
        
        // output 是数组
        if (Array.isArray(response.data.output)) {
          for (const item of response.data.output) {
            // 提取消息内容
            if (item.type === 'message' && item.content) {
              if (Array.isArray(item.content)) {
                for (const content of item.content) {
                  if (content.type === 'output_text' && content.text) {
                    resultContent += content.text + '\n';
                  }
                }
              }
            }
            // 提取推理过程（如果需要可以保留）
            // if (item.type === 'reasoning' && item.summary) {
            //   if (Array.isArray(item.summary)) {
            //     for (const summary of item.summary) {
            //       if (summary.text) {
            //         resultContent += summary.text + '\n';
            //       }
            //     }
            //   }
            // }
          }
        }
      }
      
      // 如果没找到，尝试其他常见格式
      if (!resultContent) {
        if (response.data.choices && response.data.choices.length > 0) {
          const choice = response.data.choices[0];
          resultContent = choice.message?.content || choice.text || '';
        } else if (response.data.content) {
          resultContent = response.data.content;
        } else {
          resultContent = '分析完成，但无法提取文本内容';
        }
      }
    }

    // 清理结果文本
    resultContent = (resultContent || '分析完成，但没有具体内容').trim();
    
    console.log('最终返回内容长度:', resultContent.length);
    console.log('最终返回内容预览:', resultContent.substring(0, 200));
    
    return { content: resultContent };
    
  } catch (error) {
    console.error('API调用错误详情:');
    if (error.response) {
      console.error('错误状态:', error.response.status);
      console.error('错误数据:', JSON.stringify(error.response.data, null, 2));
      
      let errorMessage = `API错误 ${error.response.status}: `;
      if (error.response.data && error.response.data.error) {
        const errorDetail = error.response.data.error;
        errorMessage += errorDetail.message || errorDetail.code || JSON.stringify(errorDetail);
      } else if (error.response.data && error.response.data.message) {
        errorMessage += error.response.data.message;
      } else {
        errorMessage += JSON.stringify(error.response.data);
      }
      
      throw new Error(errorMessage);
    } else if (error.request) {
      console.error('没有收到响应，可能超时');
      throw new Error('API响应超时，请稍后重试');
    } else {
      console.error('请求错误:', error.message);
      throw new Error(`请求错误: ${error.message}`);
    }
  }
}

// 上传图片并分析
app.post('/api/analyze', upload.array('images', 10), async (req, res) => {
  try {
    // 检查是否有文件上传
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '请上传图片' });
    }

    // 检查图片数量
    if (req.files.length < 5) {
      return res.status(400).json({ error: `请上传至少5张图片，当前${req.files.length}张` });
    }

    console.log(`收到${req.files.length}张图片，开始分析...`);
    
    const imagePaths = req.files.map(file => file.path);

    try {
      // 调用AI分析
      console.log('开始调用豆包API...');
      const result = await callDoubaoAPI(imagePaths);
      console.log('分析完成，准备返回结果');

      // 构建返回数据
      const responseData = {
        success: true,
        responses: [{
          content: result.content
        }],
        timestamp: new Date().toISOString()
      };

      // 删除临时文件
      console.log('开始删除临时文件...');
      for (const path of imagePaths) {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
          console.log(`已删除: ${path}`);
        }
      }

      res.json(responseData);
      
    } catch (error) {
      console.error('分析过程中出错:', error);
      
      // 发生错误时也删除文件
      for (const path of imagePaths) {
        if (fs.existsSync(path)) {
          fs.unlinkSync(path);
        }
      }
      
      res.status(500).json({ 
        error: error.message,
        details: 'AI分析过程出错'
      });
    }
  } catch (error) {
    console.error('请求处理错误:', error);
    res.status(500).json({ 
      error: error.message,
      details: '服务器处理请求时出错'
    });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: '服务器运行正常'
  });
});

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 错误处理中间件
app.use((error, req, res, next) => {
  console.error('服务器错误:', error);
  res.status(500).json({ 
    error: error.message || '服务器内部错误'
  });
});

app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  console.log(`📝 测试健康检查: http://localhost:${PORT}/api/health`);
  console.log(`📤 上传分析接口: POST http://localhost:${PORT}/api/analyze`);
  console.log(`=================================`);
});