# 报告用简体中文字体

`NotoSansSC-Regular.ttf`（400）和 `NotoSansSC-Bold.ttf`（700）来自 Google Fonts 发布的 [Noto Sans SC](https://github.com/google/fonts/tree/main/ofl/notosanssc)。字体仅在报告使用中文或包含汉字原文时于服务端读取，不在生成报告时请求外部字体服务。

上游变量字体 `NotoSansSC[wght].ttf` 的 SHA-256：`a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da`。本仓库使用 FontTools 4.67.0 的 `instantiateVariableFont` 固定 `wght=400/700`、`updateFontNames=True` 生成静态 TrueType 文件；保留完整字符映射，未按示例文本裁剪用户可用的汉字。

版权与再分发条款见同目录原文 [NotoSansSC-OFL.txt](NotoSansSC-OFL.txt)。上游保留字体名为 Source；这些文件保持 Noto Sans SC 名称。为沿用现有 PDF 分节和表格代码，仅在单份文档实例内注册为 Helvetica family 的 normal/bold/italic/bolditalic 别名；斜体样式使用对应的正体字形。
