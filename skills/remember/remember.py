#!/usr/bin/env python3
"""记住用户偏好脚本"""
import sys
import json
from pathlib import Path
from datetime import datetime

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "缺少偏好参数"}, ensure_ascii=False))
        sys.exit(1)

    preference = " ".join(sys.argv[1:])

    # 读取现有偏好
    behavior_file = Path(__file__).parent.parent.parent / "prompts" / "behavior.md"

    try:
        if behavior_file.exists():
            content = behavior_file.read_text(encoding="utf-8")
            # 提取现有偏好列表
            lines = content.split("\n")
            preferences = []
            in_prefs = False
            for line in lines:
                if line.strip().startswith("- "):
                    preferences.append(line.strip()[2:])
                    in_prefs = True
                elif in_prefs and not line.strip():
                    break
        else:
            preferences = []

        # 添加新偏好
        preferences.append(preference)

        # 写入文件
        new_content = "## 用户偏好\n\n" + "\n".join(f"- {p}" for p in preferences) + "\n"
        behavior_file.write_text(new_content, encoding="utf-8")

        print(json.dumps({
            "success": True,
            "message": f"已记住：{preference}。下次会话生效。"
        }, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)

if __name__ == "__main__":
    main()
