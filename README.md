# file-to-chat

Hermes 桌面端插件（desktop plugin）：把侧边栏文件树里的文件加到当前对话。

两个入口，行为一致 —— 在输入框插入 `@file:` 引用芯片，和把文件行拖进输入框得到的东西相同：

- **悬停文件行**：行右缘出现 `@`，点击即添加。
- **右键文件行**：菜单顶部多出「添加到对话」。

工作区内的文件用相对于 cwd 的路径，工作区外的文件用绝对路径。

## 安装

```
<hermes home>/desktop-plugins/file-to-chat/plugin.js
```

Windows 默认是 `%LOCALAPPDATA%\hermes\desktop-plugins\file-to-chat\plugin.js`。文件夹名必须与插件 id（`file-to-chat`）一致。应用会在几秒内自动加载；没出现时用 Ctrl+K → **Reload desktop plugins**。

## 作用范围

只作用于文件面板的项目树行（`.group/row`）。git 变更树和文件夹行不提供入口。行与菜单的选择器对应 desktop 端 `ProjectTreeRow` / `FileEntryContextMenu` 的 DOM，随应用改动可能失效。

## 依赖

Hermes 桌面端插件 SDK（`@hermes/plugin-sdk`）的 `host.composer.insertText` 与 `host.notify`，无其他依赖。
