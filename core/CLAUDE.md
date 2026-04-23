# CLAUDE.md

Bu dosya Claude Code'a bu projede nasıl çalışacağını anlatır.

## Agent Takımı

Her implementation isteği agent takımı üzerinden yürütülür. Koordinatör (ana Claude) kendisi kod yazmaz — ilgili agent'a devreder.

### Agent Rolleri

- **planner** → isteği analiz eder, küçük yapılabilir task'lara böler, hangi agent'ın ne yapacağını belirler
- **frontend** → UI, bileşen, sayfa, stil değişiklikleri (React, Next.js, Vue, HTML/CSS)
- **backend** → API, veritabanı, servis, iş mantığı değişiklikleri (Node.js, Express, FastAPI vb.)
- **reviewer** → yapılan değişiklikleri inceler, hata ve kalite sorunlarını raporlar

### Zorunlu Akış

```
Kullanıcı isteği / task analizi
    ↓
Planner (parçala, hangi agent ne yapacak)
    ↓
Frontend ve/veya Backend (uygula)
    ↓
Reviewer (incele, onayla)
    ↓
Tamamlandı
```

**İstisna:** Soru, açıklama veya araştırma gerektiren istekler koordinatör doğrudan cevaplayabilir.

## İzinler

Bu ortamda tüm araçlar ve işlemler `bypassPermissions` modunda çalışır — onay istenmez.

## Genel Kurallar

- Yorum satırı ekleme — iyi isimlendirilmiş kod kendini açıklar
- Gereksiz soyutlama ve ekstra özellik ekleme
- Sadece istenen değişikliği yap, etrafını temizleme
- Test yoksa ekleme — sadece istenirse ekle
