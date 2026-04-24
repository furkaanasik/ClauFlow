# CLAUDE.md

Bu dosya Claude Code'a bu projede nasıl çalışacağını anlatır.

## Agent Takımı

Agent takımı mevcut ama **her iş için takım kurulmaz** — takım kurma/spawn/shutdown zincirinin token maliyeti küçük işlerde faydayı geçer. Koordinatör önce iş büyüklüğüne bakıp karar verir.

### Agent Rolleri

- **planner** → isteği analiz eder, küçük yapılabilir task'lara böler, hangi agent'ın ne yapacağını belirler
- **frontend** → UI, bileşen, sayfa, stil değişiklikleri (React, Next.js, Vue, HTML/CSS)
- **backend** → API, veritabanı, servis, iş mantığı değişiklikleri (Node.js, Express, FastAPI vb.)
- **reviewer** → yapılan değişiklikleri inceler, hata ve kalite sorunlarını raporlar

### Ne Zaman Takım, Ne Zaman Koordinatör?

**Koordinatör direkt çözer** (takım kurmadan):
- Soru, açıklama, araştırma (zaten istisna)
- Tek dosyada birkaç satırlık bug fix
- Dokümantasyon, config, memory güncellemeleri
- DB'ye tek seferlik veri işlemi
- Dosya taşıma/yeniden adlandırma, küçük string/stil düzeltmeleri
- Açıkça lokalize ve tek domainli değişiklikler

**Takım kurulur** (TeamCreate → planner → ilgili agent'lar → reviewer → TeamDelete):
- Birden fazla alana dokunan iş (frontend + backend, UI + DB, vb.)
- Yeni özellik / non-trivial refactor / mimari karar
- 4+ dosyada koordinasyon gerektiren değişiklikler
- Kullanıcı açıkça "takım kur", "planla", "reviewer'a göster" dediğinde

Emin değilsen küçük tarafa kay — takım kurmak pahalı, gereksizse yapma.

### Takım Kurulumu (Takım kararı verildiğinde)

**TeamCreate** ile takımı ayağa kaldır:

```
TeamCreate({ team_name: "<feature-slug>", agent_type: "team-lead", description: "<kısa amaç>" })
```

Agent'ları spawn ederken `team_name` ve `name` parametrelerini mutlaka geç:

```
Agent({ subagent_type: "planner", name: "planner", team_name: "<feature-slug>", prompt: "..." })
```

SendMessage ile `to: "<name>"` üzerinden iletişim kur — **sadece takım üyesi olan agent'lara mesaj gidebilir, takımsız spawn edilen agent'a SendMessage ulaşmaz.**

İş bitince: tüm agent'lara `{ type: "shutdown_request" }` gönder, sonra `TeamDelete`.

## İzinler

Bu ortamda tüm araçlar ve işlemler `bypassPermissions` modunda çalışır — onay istenmez.

## Genel Kurallar

- Yorum satırı ekleme — iyi isimlendirilmiş kod kendini açıklar
- Gereksiz soyutlama ve ekstra özellik ekleme
- Sadece istenen değişikliği yap, etrafını temizleme
- Test yoksa ekleme — sadece istenirse ekle
