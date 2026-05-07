const fs = require('fs');
const path = require('path');

// Dosya yolunu doğrudan node_modules içine hedefliyoruz
const filePath = path.join(process.cwd(), 'node_modules', '@jubbio', 'core', 'dist', 'Client.js');

console.log('Yamalanacak dosya aranıyor:', filePath);

if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('selfDeaf: true')) {
        content = content.replace('selfDeaf: true', 'selfDeaf: false');
        fs.writeFileSync(filePath, content);
        console.log('✅ Jubbio ses yaması başarıyla uygulandı!');
    } else {
        console.log('ℹ️ Dosya zaten yamalı veya uygun satır bulunamadı.');
    }
} else {
    console.log('❌ HATA: Jubbio kütüphane dosyası bulunamadı! Yol kontrol edilmeli.');
}
