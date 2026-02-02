# GitHub Pages デプロイ手順

## 1. GitHubリポジトリを作成
1. GitHubで新しいリポジトリを作成（例: `ideal-calendar-support`）
2. Publicに設定

## 2. ファイルをアップロード
```bash
cd /Users/gan/Desktop/calendar/appstore/pages
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/ideal-calendar-support.git
git push -u origin main
```

## 3. GitHub Pagesを有効化
1. リポジトリの「Settings」→「Pages」
2. Source: 「Deploy from a branch」
3. Branch: `main` / `/ (root)`を選択
4. 「Save」をクリック

## 4. URLを取得
数分後、以下のURLでアクセス可能になります：
- サポートページ: `https://YOUR_USERNAME.github.io/ideal-calendar-support/support.html`
- プライバシーポリシー: `https://YOUR_USERNAME.github.io/ideal-calendar-support/privacy-policy.html`

## 5. App Store Connectに登録
上記のURLをApp Store Connectの以下の項目に入力：
- サポートURL
- プライバシーポリシーURL

## メールアドレスの更新
`support.html`と`privacy-policy.html`内の`support@example.com`を実際のメールアドレスに変更してください。
