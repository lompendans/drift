// Drift's translations. The pages are written in English; this file swaps their text for the chosen language.
// In a page it reads <html lang> (the host fills it in when serving drift:// pages), translates the page as it
// loads and keeps translating whatever the page adds later. In the main process, require() it for T().
(function (root) {
  "use strict";

  // Exact English text -> Turkish.
  const TR = {
    // window and sidebar
    "New tab": "Yeni sekme", "New Tab": "Yeni Sekme", "Tabs": "Sekmeler", "Settings": "Ayarlar", "History": "Geçmiş",
    "Bookmarks": "Yer imleri", "About Drift": "Drift hakkında", "Downloads": "İndirilenler", "Extensions": "Uzantılar",
    "Collapse sidebar (Ctrl+B)": "Kenar çubuğunu daralt (Ctrl+B)", "Expand sidebar (Ctrl+B)": "Kenar çubuğunu genişlet (Ctrl+B)",
    "New tab (Ctrl+T)": "Yeni sekme (Ctrl+T)", "Settings (Ctrl+,)": "Ayarlar (Ctrl+,)", "History (Ctrl+H)": "Geçmiş (Ctrl+H)",
    "Bookmarks (Ctrl+Shift+O)": "Yer imleri (Ctrl+Shift+O)", "Back (Alt+Left)": "Geri (Alt+Sol)", "Forward (Alt+Right)": "İleri (Alt+Sağ)",
    "Reload (Ctrl+R)": "Yeniden yükle (Ctrl+R)", "Home (Alt+Home)": "Ana sayfa (Alt+Home)",
    "Search or enter address": "Arayın veya adres girin", "Search or enter address (Ctrl+L)": "Arayın veya adres girin (Ctrl+L)",
    "Bookmark this page (Ctrl+D)": "Bu sayfayı yer imlerine ekle (Ctrl+D)", "Remove bookmark (Ctrl+D)": "Yer imini kaldır (Ctrl+D)",
    "Restart Drift to finish updating": "Güncellemeyi bitirmek için Drift'i yeniden başlatın", "Update": "Güncelle",
    "Downloads (Ctrl+J)": "İndirilenler (Ctrl+J)", "Minimize": "Simge durumuna küçült", "Maximize": "Ekranı kapla", "Restore": "Önceki boyut",
    "Close": "Kapat", "Close tab (Ctrl+W)": "Sekmeyi kapat (Ctrl+W)", "Ad blocker": "Reklam engelleyici", "Switch tabs": "Sekme değiştir",

    // permission and store bars
    "Block": "Engelle", "Allow": "İzin ver", "Not now": "Şimdi değil", "Add this extension to Drift": "Bu uzantıyı Drift'e ekle",
    "Add to Drift": "Drift'e ekle", "Add extension": "Uzantı ekle", "Hide": "Gizle", "This extension is in Drift": "Bu uzantı Drift'te yüklü",
    "Manage": "Yönet", "Adding this extension to Drift…": "Bu uzantı Drift'e ekleniyor…", "Adding…": "Ekleniyor…",
    "· manage it from the puzzle button": "· yapboz düğmesinden yönetin",
    "· the store's own button only works in Chrome": "· mağazanın kendi düğmesi yalnızca Chrome'da çalışır",
    "This site": "Bu site", "This page": "Bu sayfa", "and": "ve",
    "show notifications": "bildirim göstermek", "use your camera": "kameranızı kullanmak", "use your microphone": "mikrofonunuzu kullanmak",
    "use your camera and microphone": "kameranızı ve mikrofonunuzu kullanmak", "know your location": "konumunuzu bilmek",
    "see text and images you copy": "kopyaladığınız metin ve görselleri görmek", "download multiple files": "birden çok dosya indirmek",
    "edit files on your device": "cihazınızdaki dosyaları düzenlemek", "use motion and light sensors": "hareket ve ışık sensörlerini kullanmak",
    "use the fonts installed on your PC": "bilgisayarınızda yüklü yazı tiplerini kullanmak", "control your MIDI devices": "MIDI cihazlarınızı kontrol etmek",
    "manage windows on all your displays": "tüm ekranlarınızdaki pencereleri yönetmek", "use a feature of your device": "cihazınızın bir özelliğini kullanmak",
    "Notifications": "Bildirimler", "Camera": "Kamera", "Microphone": "Mikrofon", "Location": "Konum", "Clipboard": "Pano",
    "Automatic downloads": "Otomatik indirmeler", "Editing files": "Dosya düzenleme", "Motion sensors": "Hareket sensörleri",
    "Installed fonts": "Yüklü yazı tipleri", "MIDI devices": "MIDI cihazları", "Window management": "Pencere yönetimi", "Other": "Diğer",

    // page error card
    "Try again": "Tekrar dene", "Go back": "Geri dön", "Trying again…": "Tekrar deneniyor…",
    "Drift couldn't find a server for this address. It may be misspelled, or the site may not exist anymore.": "Drift bu adres için bir sunucu bulamadı. Adres yanlış yazılmış olabilir ya da site artık yok.",
    "Check the spelling of the address.": "Adresin yazımını kontrol edin.", "If no sites load, check your internet connection.": "Hiçbir site açılmıyorsa internet bağlantınızı kontrol edin.",
    "You're offline": "Çevrimdışısınız", "Drift can't reach the internet right now, so this page couldn't load.": "Drift şu anda internete ulaşamıyor, bu yüzden sayfa yüklenemedi.",
    "Check your Wi-Fi or network cable.": "Wi-Fi'nizi veya ağ kablonuzu kontrol edin.", "Turn off airplane mode.": "Uçak modunu kapatın.",
    "If other devices are offline too, restart your router.": "Diğer cihazlar da çevrimdışıysa modeminizi yeniden başlatın.",
    "The site's server refused or dropped the connection. It may be down for a moment.": "Sitenin sunucusu bağlantıyı reddetti ya da kesti. Kısa süreliğine çökmüş olabilir.",
    "Try again in a minute.": "Bir dakika sonra tekrar deneyin.", "Make sure the address is right.": "Adresin doğru olduğundan emin olun.",
    "A firewall, VPN or proxy might be blocking this site.": "Bir güvenlik duvarı, VPN veya proxy bu siteyi engelliyor olabilir.",
    "The server didn't answer in time. It may be busy or having problems.": "Sunucu zamanında yanıt vermedi. Meşgul olabilir ya da sorun yaşıyor olabilir.",
    "Try again.": "Tekrar deneyin.", "Check that your connection isn't slow.": "Bağlantınızın yavaş olmadığından emin olun.",
    "If the site is very busy, come back later.": "Site çok yoğunsa daha sonra tekrar gelin.",
    "This connection isn't private": "Bu bağlantı gizli değil",
    "Make sure your computer's date and time are correct.": "Bilgisayarınızın tarih ve saatinin doğru olduğundan emin olun.",
    "Don't enter passwords or payment details on this site.": "Bu sitede şifre veya ödeme bilgisi girmeyin.",
    "If this is your own site, renew or fix its certificate.": "Bu sizin sitenizse sertifikasını yenileyin veya düzeltin.",
    "The site keeps sending Drift from one address to another without ever showing a page.": "Site, hiçbir sayfa göstermeden Drift'i sürekli bir adresten diğerine yönlendiriyor.",
    "Clearing this site's cookies often fixes it.": "Bu sitenin çerezlerini temizlemek genellikle sorunu çözer.",
    "The server answered, but Drift couldn't understand the reply.": "Sunucu yanıt verdi ama Drift yanıtı anlayamadı.",
    "The site may be having problems. Check back later.": "Site sorun yaşıyor olabilir. Daha sonra tekrar bakın.",
    "This page didn't load": "Bu sayfa yüklenmedi", "Something went wrong while loading this page.": "Bu sayfa yüklenirken bir şeyler ters gitti.",
    "If it keeps happening, check your connection.": "Tekrarlarsa bağlantınızı kontrol edin.",

    // palette
    "to move": "gezin", "to open": "aç", "in new tab": "yeni sekmede aç", "Open a new tab: search or enter address": "Yeni sekme açın: arayın veya adres girin",
    "Open website": "Web sitesini aç", "Open": "Aç", "Search": "Ara", "Switch to tab": "Sekmeye geç", "Bookmark": "Yer imi",
    "Open tabs": "Açık sekmeler", "Recently visited": "Son ziyaret edilenler",

    // history
    "Search history": "Geçmişte ara", "Clear history": "Geçmişi temizle", "Clear history from": "Şu süredeki geçmişi temizle:",
    "The last hour": "Son bir saat", "Today": "Bugün", "Yesterday": "Dün", "today": "bugün", "yesterday": "dün", "All time": "Tüm zamanlar", "Cancel": "İptal",
    "No pages match your search.": "Aramanızla eşleşen sayfa yok.", "Pages you visit will show up here.": "Ziyaret ettiğiniz sayfalar burada görünür.",
    "Remove from history": "Geçmişten kaldır",

    // downloads
    "Open folder": "Klasörü aç", "Clear list": "Listeyi temizle", "Starting…": "Başlıyor…", "Deleted": "Silindi", "Failed": "Başarısız",
    "Pause": "Duraklat", "Canceled": "İptal edildi", "Resume": "Sürdür", "Show in folder": "Klasörde göster", "Download again": "Yeniden indir", "Remove from list": "Listeden kaldır",
    "Files you download will show up here.": "İndirdiğiniz dosyalar burada görünür.", "Network error": "Ağ hatası",
    "The download was interrupted": "İndirme yarıda kesildi", "Drift was closed before it finished": "Drift, indirme bitmeden kapatıldı",

    // dialogs
    "Leave site?": "Siteden ayrılınsın mı?", "Changes you made may not be saved.": "Yaptığınız değişiklikler kaydedilmeyebilir.",
    "Leave": "Ayrıl", "Stay": "Kal", "OK": "Tamam", "Sign in": "Oturum aç", "Answer": "Yanıt", "User name": "Kullanıcı adı", "Password": "Şifre",
    "This site asks for your user name and password.": "Bu site kullanıcı adınızı ve şifrenizi istiyor.",
    "From a folder on this computer. It will be able to:": "Bu bilgisayardaki bir klasörden. Şunları yapabilecek:",
    "Share": "Paylaş", "Choose what the site can see. It sees it until you stop sharing.": "Sitenin neyi göreceğini seçin. Paylaşımı durdurana kadar görür.",
    "Share sound too": "Sesi de paylaş", "Entire screen": "Tüm ekran", "Window": "Pencere",
    "No screens to share.": "Paylaşılacak ekran yok.", "No windows to share.": "Paylaşılacak pencere yok.",
    "It doesn't ask for any special permissions.": "Özel bir izin istemiyor.",
    "Read and change everything on all websites": "Tüm web sitelerindeki her şeyi okuyup değiştirme",
    "Read and change your browsing history": "Tarama geçmişinizi okuyup değiştirme", "See the addresses of your open tabs": "Açık sekmelerinizin adreslerini görme",
    "Read and change your bookmarks": "Yer imlerinizi okuyup değiştirme", "Manage your downloads": "İndirmelerinizi yönetme", "Read and change cookies": "Çerezleri okuyup değiştirme",
    "Read what you copy": "Kopyaladıklarınızı okuma", "Change what's on your clipboard": "Panonuzdakini değiştirme", "Block content on pages": "Sayfalardaki içeriği engelleme",
    "Block and change page requests": "Sayfa isteklerini engelleme ve değiştirme", "Show notifications": "Bildirim gösterme",
    "Talk to programs on your computer": "Bilgisayarınızdaki programlarla konuşma", "Manage your other extensions": "Diğer uzantılarınızı yönetme",
    "Change your proxy settings": "Proxy ayarlarınızı değiştirme", "Change privacy settings": "Gizlilik ayarlarını değiştirme",
    "Know your location": "Konumunuzu bilme", "Capture your screen": "Ekranınızı yakalama", "Control pages with the debugger": "Sayfaları hata ayıklayıcıyla kontrol etme",

    // site permissions
    "Site permissions": "Site izinleri", "What websites are allowed to do": "Web sitelerinin neler yapabileceği",
    "Websites ask before they use these. Change or reset an answer here at any time.": "Web siteleri bunları kullanmadan önce sorar. Bir yanıtı buradan istediğiniz zaman değiştirin veya sıfırlayın.",
    "When you allow or block something for a site, it shows up here.": "Bir siteye bir şey için izin verdiğinizde veya engellediğinizde burada görünür.",
    "Allowed": "İzin verildi", "Blocked": "Engellendi", "Remove": "Kaldır", "Reset (ask again next time)": "Sıfırla (bir dahaki sefere tekrar sor)",

    // ad blocker
    "Block ads on this site": "Bu sitede reklamları engelle", "Turn this off if the site doesn't work right.": "Site düzgün çalışmazsa bunu kapatın.",
    "Ad blocker settings": "Reklam engelleyici ayarları", "Ad blocker is on": "Reklam engelleyici açık", "Ad blocker is off for this site": "Reklam engelleyici bu sitede kapalı",
    "Ad blocker is off": "Reklam engelleyici kapalı", "Nothing blocked yet": "Henüz bir şey engellenmedi", "Ads allowed on this site": "Bu sitede reklamlara izin verildi",
    "Ads and trackers load on every site.": "Reklamlar ve izleyiciler her sitede yüklenir.", "Nothing to block here": "Burada engellenecek bir şey yok",
    "Open a website to see what Drift blocks.": "Drift'in neleri engellediğini görmek için bir web sitesi açın.",
    "Drift hasn't found any ads or trackers on this page.": "Drift bu sayfada reklam veya izleyici bulmadı.",
    "Filter lists": "Filtre listeleri", "Loading…": "Yükleniyor…", "Update now": "Şimdi güncelle", "Updating…": "Güncelleniyor…",
    "Lists from uBlock Origin, EasyList, AdGuard and Peter Lowe. They refresh on their own every 4 days.": "uBlock Origin, EasyList, AdGuard ve Peter Lowe listeleri. 4 günde bir kendiliğinden yenilenirler.",
    "Core ad blocking": "Temel reklam engelleme", "Privacy and tracking": "Gizlilik ve izleme",
    "Annoyances: banners, cookie dialogs, pop-ups, widgets": "Rahatsız ediciler: afişler, çerez pencereleri, açılır pencereler, araçlar",
    "Security and compatibility": "Güvenlik ve uyumluluk", "Optional": "İsteğe bağlı", "Downloading…": "İndiriliyor…",
    "Couldn't download. Check your connection and press Update now.": "İndirilemedi. Bağlantınızı kontrol edip Şimdi güncelle'ye basın.",
    "Waiting to download": "İndirilmeyi bekliyor", "Not downloaded": "İndirilmedi", "The ad blocker is off. Turn it on in Settings.": "Reklam engelleyici kapalı. Ayarlar'dan açın.",
    "Your filter lists": "Filtre listeleriniz",

    // about
    "Drift is up to date": "Drift güncel", "Check for updates": "Güncellemeleri denetle", "Checking for updates…": "Güncellemeler denetleniyor…",
    "Restart Drift to finish updating. Your tabs come back.": "Güncellemeyi bitirmek için Drift'i yeniden başlatın. Sekmeleriniz geri gelir.",
    "Restart to update": "Güncellemek için yeniden başlat", "Restarting…": "Yeniden başlatılıyor…",
    "This copy of Drift can't update itself. Get the new version from the download page.": "Drift'in bu kopyası kendini güncelleyemez. Yeni sürümü indirme sayfasından alın.",
    "Open download page": "İndirme sayfasını aç", "Couldn't check for updates": "Güncellemeler denetlenemedi", "Updates are checked automatically.": "Güncellemeler otomatik olarak denetlenir.",
    "The release has no file for this computer": "Bu sürümde bu bilgisayar için dosya yok", "The release has no checksum": "Bu sürümün sağlama toplamı yok",
    "The download didn't match its checksum": "İndirilen dosya sağlama toplamıyla eşleşmedi",
    "Tabs open": "Açık sekme", "Sleeping": "Uyuyan", "Memory in use": "Kullanılan bellek", "Running for": "Çalışma süresi",
    "Browser": "Tarayıcı", "This computer": "Bu bilgisayar", "Your data": "Verileriniz", "Open data folder": "Veri klasörünü aç",
    "Copy info": "Bilgileri kopyala", "Copied": "Kopyalandı", "Couldn't copy": "Kopyalanamadı", "Keyboard shortcuts": "Klavye kısayolları",
    "Web engine": "Web motoru", "User agent": "Kullanıcı aracısı", "Operating system": "İşletim sistemi", "Architecture": "Mimari", "Folder": "Klasör",
    "Search engine": "Arama motoru", "Home page": "Ana sayfa", "Drift start page": "Drift başlangıç sayfası", "Off": "Kapalı", "On": "Açık",

    // bookmarks and import
    "Search bookmarks": "Yer imlerinde ara", "Import…": "İçe aktar…", "No bookmarks match your search.": "Aramanızla eşleşen yer imi yok.",
    "Click the star in the address bar (Ctrl+D) to save a page, or bring your bookmarks from another browser.": "Bir sayfayı kaydetmek için adres çubuğundaki yıldıza (Ctrl+D) tıklayın ya da yer imlerinizi başka bir tarayıcıdan getirin.",
    "Import bookmarks": "Yer imlerini içe aktar", "Delete bookmark": "Yer imini sil", "Saved in Drift": "Drift'te kaydedilenler",
    "Bookmarks bar": "Yer imleri çubuğu", "Other bookmarks": "Diğer yer imleri", "Mobile bookmarks": "Mobil yer imleri",
    "Bookmarks toolbar": "Yer imleri araç çubuğu", "Bookmarks menu": "Yer imleri menüsü",
    "Import from another browser": "Başka bir tarayıcıdan içe aktar",
    "Bring your history and bookmarks into Drift. The other browser isn't changed.": "Geçmişinizi ve yer imlerinizi Drift'e getirin. Diğer tarayıcı değişmez.",
    "Looking for browsers…": "Tarayıcılar aranıyor…", "Import": "İçe aktar", "Counting…": "Sayılıyor…", "Couldn't read this profile": "Bu profil okunamadı",
    "Drift didn't find Chrome, Edge, Firefox, Brave, Opera or Vivaldi on this computer.": "Drift bu bilgisayarda Chrome, Edge, Firefox, Brave, Opera veya Vivaldi bulamadı.",
    "Pick at least one thing to import.": "İçe aktarmak için en az bir şey seçin.", "Importing…": "İçe aktarılıyor…", "Show bookmarks": "Yer imlerini göster", "Done": "Bitti",

    // extensions
    "Add extensions from the Chrome Web Store or Edge Add-ons.": "Chrome Web Mağazası'ndan veya Edge Eklentileri'nden uzantı ekleyin.",
    "Browse the store": "Mağazaya göz at", "Load folder…": "Klasör yükle…", "Add": "Ekle",
    "Paste a Chrome Web Store or Edge Add-ons link": "Bir Chrome Web Mağazası veya Edge Eklentileri bağlantısı yapıştırın", "Extension link": "Uzantı bağlantısı",
    "Drift runs Chrome extensions with its built-in Chromium engine. Simple ones work best; some Chrome features aren’t supported yet.": "Drift, Chrome uzantılarını yerleşik Chromium motoruyla çalıştırır. Basit uzantılar en iyi sonucu verir; bazı Chrome özellikleri henüz desteklenmiyor.",
    "No extensions yet. Open an extension on the Chrome Web Store and click “Add to Drift”, or paste its link above.": "Henüz uzantı yok. Chrome Web Mağazası'nda bir uzantı açıp “Drift'e ekle”ye tıklayın ya da bağlantısını yukarıya yapıştırın.",
    "Loaded from a folder": "Bir klasörden yüklendi", "Options": "Seçenekler", "Unpin from toolbar": "Araç çubuğundan ayır", "Pin to toolbar": "Araç çubuğuna sabitle",
    "Turn off": "Kapat", "Turn on": "Aç", "Downloading the extension…": "Uzantı indiriliyor…", "Waiting for you to confirm…": "Onaylamanız bekleniyor…",
    "Couldn't add it": "Eklenemedi", "Paste a link to an extension on the Chrome Web Store or Edge Add-ons.": "Chrome Web Mağazası'ndaki veya Edge Eklentileri'ndeki bir uzantının bağlantısını yapıştırın.",
    "That folder has no manifest.json, so it isn't an extension.": "Bu klasörde manifest.json yok, yani bir uzantı değil.",
    "Its manifest.json couldn't be read.": "manifest.json dosyası okunamadı.", "The store didn't send an extension. It may not be available.": "Mağaza bir uzantı göndermedi. Uzantı kullanılamıyor olabilir.",
    "The extension package is damaged.": "Uzantı paketi bozuk.", "That download isn't an extension.": "İndirilen dosya bir uzantı değil.",
    "Choose the folder that contains the extension's manifest.json": "Uzantının manifest.json dosyasını içeren klasörü seçin",

    // settings
    "General": "Genel", "Language": "Dil", "System": "Sistem", "Light": "Açık", "Dark": "Koyu", "Appearance": "Görünüm", "Theme": "Tema",
    "A specific page": "Belirli bir sayfa", "Use current page": "Geçerli sayfayı kullan", "Home page address": "Ana sayfa adresi",
    "Press Enter to save.": "Kaydetmek için Enter'a basın.", "Type an address and press Enter to save.": "Bir adres yazıp kaydetmek için Enter'a basın.",
    "Block ads and trackers": "Reklamları ve izleyicileri engelle", "Choose filter lists ›": "Filtre listelerini seç ›", "Manage extensions ›": "Uzantıları yönet ›",
    "Import bookmarks and history ›": "Yer imlerini ve geçmişi içe aktar ›", "Privacy": "Gizlilik", "Privacy and data": "Gizlilik ve veriler", "Site permissions ›": "Site izinleri ›",
    "About Drift ›": "Drift hakkında ›", "On startup": "Açılışta", "Reopen your tabs": "Sekmelerinizi yeniden aç", "Open the home page": "Ana sayfayı aç",
    "Accent color": "Vurgu rengi", "Teal": "Turkuaz", "Blue": "Mavi", "Purple": "Mor", "Pink": "Pembe", "Orange": "Turuncu", "Graphite": "Grafit",
    "Tab list": "Sekme listesi", "Corners": "Köşeler", "Rounded": "Yuvarlak", "Square": "Köşeli", "Comfortable": "Rahat", "Compact": "Sıkışık", "Show the Home button": "Ana sayfa düğmesini göster",
    "Start page": "Başlangıç sayfası", "Show the clock": "Saati göster", "Show shortcuts": "Kısayolları göster", "Background": "Arka plan",
    "Soft glow": "Yumuşak ışıltı", "Plain": "Düz", "Reset shortcuts to most visited ›": "Kısayolları en çok ziyaret edilenlere sıfırla ›",
    "Your shortcuts are the sites you visit most.": "Kısayollarınız en çok ziyaret ettiğiniz sitelerdir.",
    "Hover a shortcut on the start page to edit it.": "Düzenlemek için başlangıç sayfasındaki bir kısayolun üzerine gelin.",
    "Reopen closed tab": "Kapatılan sekmeyi yeniden aç", "Close tab": "Sekmeyi kapat", "Switch tabs (hold Ctrl, tap Tab)": "Sekme değiştir (Ctrl'yi basılı tutup Tab'a dokunun)",
    "Bookmark this page": "Bu sayfayı yer imlerine ekle", "Go to tab": "Sekmeye git", "Go to your home page": "Ana sayfanıza gidin",
    "Collapse or expand the sidebar": "Kenar çubuğunu daralt veya genişlet", "Full screen": "Tam ekran",

    // start page and blocked page
    "Search the web or enter address": "Web'de arayın veya adres girin", "Sites you visit often will show up here.": "Sık ziyaret ettiğiniz siteler burada görünür.",
    "Add shortcut": "Kısayol ekle", "Edit shortcut": "Kısayolu düzenle", "Name": "Ad", "URL": "URL", "More actions": "Diğer işlemler",
    "Page blocked": "Sayfa engellendi", "Drift blocked this page": "Drift bu sayfayı engelledi",
    "This site is on a list of pages known for scams, malware or deceptive downloads.": "Bu site; dolandırıcılık, kötü amaçlı yazılım veya aldatıcı indirmelerle bilinen sayfalar listesinde.",
    "Go back to safety": "Güvenli sayfaya dön", "Continue anyway": "Yine de devam et",

    // right-click menu
    "Back": "Geri", "Forward": "İleri", "Reload": "Yeniden yükle", "Print…": "Yazdır…", "Save page as…": "Sayfayı farklı kaydet…", "View page source": "Sayfa kaynağını görüntüle",
    "Open link in new tab": "Bağlantıyı yeni sekmede aç", "Open link in new tab and switch": "Bağlantıyı yeni sekmede aç ve geç", "Copy link": "Bağlantıyı kopyala",
    "Save link as…": "Bağlantıyı farklı kaydet…", "Open image in new tab": "Görseli yeni sekmede aç", "Copy image": "Görseli kopyala",
    "Copy image address": "Görsel adresini kopyala", "Save image as…": "Görseli farklı kaydet…", "Play": "Oynat", "Loop": "Döngü", "Show controls": "Denetimleri göster",
    "Picture in picture": "Resim içinde resim", "Copy video address": "Video adresini kopyala", "Copy audio address": "Ses adresini kopyala", "Save as…": "Farklı kaydet…",
    "Undo": "Geri al", "Redo": "Yinele", "Cut": "Kes", "Copy": "Kopyala", "Paste": "Yapıştır", "Paste as plain text": "Düz metin olarak yapıştır", "Select all": "Tümünü seç",
    "No suggestions": "Öneri yok", "Add to dictionary": "Sözlüğe ekle", "Dismiss": "Kapat", "Web page, complete": "Web sayfası, tümü",
    "Close Drift": "Drift'i kapat", "Keep downloading": "İndirmeye devam et",
    "A download is still in progress. Close Drift and cancel it?": "Bir indirme hâlâ sürüyor. Drift kapatılıp indirme iptal edilsin mi?",

    // Drift for Android
    "Search or type address": "Arayın veya adres yazın", "Menu": "Menü", "Clear": "Temizle", "Close all": "Tümünü kapat", "Stop": "Durdur", "Saved": "Kaydedildi",
    "Desktop site": "Masaüstü sitesi", "Search with": "Arama motoru", "Same as phone": "Telefonla aynı", "Update filter lists": "Filtre listelerini güncelle",
    "Clear history, cookies and site data": "Geçmişi, çerezleri ve site verilerini temizle", "Signs you out of websites": "Web sitelerindeki oturumlarınızı kapatır",
    "Source code": "Kaynak kodu", "Pages in history": "Geçmişteki sayfa", "Go to this address": "Bu adrese git", "Nothing matches.": "Eşleşen bir şey yok.",
    "Tap the star in the menu to save a page here.": "Bir sayfayı buraya kaydetmek için menüdeki yıldıza dokunun.", "Pages you visit show up here.": "Ziyaret ettiğiniz sayfalar burada görünür.",
    "Files you download show up here.": "İndirdiğiniz dosyalar burada görünür.", "Removed": "Kaldırıldı", "Waiting…": "Bekleniyor…", "Delete": "Sil", "Reset": "Sıfırla",
    "History cleared": "Geçmiş temizlendi", "Updating filter lists…": "Filtre listeleri güncelleniyor…", "History, cookies and site data cleared": "Geçmiş, çerezler ve site verileri temizlendi",
    "Bookmarked": "Yer imlerine eklendi", "Bookmark removed": "Yer imi kaldırıldı", "Open in new tab": "Yeni sekmede aç", "Open in background": "Arka planda aç",
    "Share link": "Bağlantıyı paylaş", "Download link": "Bağlantıyı indir", "Download image": "Görseli indir", "Link copied": "Bağlantı kopyalandı", "Address copied": "Adres kopyalandı",
    "Install it now. Your tabs come back.": "Şimdi yükleyin. Sekmeleriniz geri gelir.", "Install": "Yükle", "Update ready": "Güncelleme hazır",
    "Check your Wi-Fi or mobile data.": "Wi-Fi'nizi veya mobil verinizi kontrol edin.", "A VPN or proxy might be blocking this site.": "Bir VPN veya proxy bu siteyi engelliyor olabilir.",
    "Make sure your phone's date and time are correct.": "Telefonunuzun tarih ve saatinin doğru olduğundan emin olun.",
    "This page is on your own network, like a router or a device at home. Android asks before an app can reach those.": "Bu sayfa modem veya evdeki bir cihaz gibi kendi ağınızda. Android, bir uygulama bunlara ulaşmadan önce sorar.",
    "Tap Allow below, then allow it when Android asks.": "Aşağıdan İzin ver'e dokunun, ardından Android sorduğunda izin verin.", "Allow local network": "Yerel ağa izin ver",
    "use your MIDI devices": "MIDI cihazlarınızı kullanmak", "see what you copy": "kopyaladıklarınızı görmek", "Off for this site": "Bu sitede kapalı",
    "Turn it on in Settings": "Ayarlar'dan açın", "Ads can show on this site": "Bu sitede reklamlar görünebilir", "Open a website to see what's blocked": "Nelerin engellendiğini görmek için bir web sitesi açın",
    "1 tab": "1 sekme", "Couldn't reach GitHub": "GitHub'a ulaşılamadı", "The release has no Android app": "Bu sürümde Android uygulaması yok",
    // Drift Legacy
    "<b>Drift Legacy is not safe to use.</b> It runs on an old engine (Chromium {v}) that no longer gets security fixes. Don't use it for banking, shopping, email or passwords.": "<b>Drift Legacy güvenli değildir.</b> Artık güvenlik güncellemesi almayan eski bir motorla (Chromium {v}) çalışır. Bankacılık, alışveriş, e-posta veya şifreler için kullanmayın.",
    "Drift Legacy · an old engine without security fixes. Don't use it for banking, shopping, email or passwords.": "Drift Legacy · güvenlik güncellemesi almayan eski bir motor. Bankacılık, alışveriş, e-posta veya şifreler için kullanmayın.",
    "Hide until Drift restarts": "Drift yeniden başlayana kadar gizle",
    "Reset shortcuts to most visited": "Kısayolları en çok ziyaret edilenlere sıfırla", "Shortcuts reset": "Kısayollar sıfırlandı", "Tap ⋮ on a shortcut on the start page to edit it.": "Düzenlemek için başlangıç sayfasındaki bir kısayolda ⋮ simgesine dokunun.",
  };

  // English sentences with parts that change. $1, $2… are translated too, so "updated yesterday" becomes "dün güncellendi".
  const TR_PATTERNS = [
    [/^Search for “(.+)” instead\.$/, "Bunun yerine “$1” için arama yapın."],
    [/^Search for “(.+)”$/, "“$1” için ara"],
    [/^Can't find (.+)$/, "$1 bulunamıyor"],
    [/^(.+) isn't responding$/, "$1 yanıt vermiyor"],
    [/^(.+) took too long to respond$/, "$1 yanıt vermekte çok gecikti"],
    [/^The security certificate for (.+) isn't valid, so Drift stopped before sending anything\. Someone could be trying to read or change your data\.$/,
      "$1 için güvenlik sertifikası geçerli değil, bu yüzden Drift hiçbir şey göndermeden durdu. Birisi verilerinizi okumaya veya değiştirmeye çalışıyor olabilir."],
    [/^(.+) redirected too many times$/, "$1 sizi çok fazla kez yönlendirdi"],
    [/^(.+) sent an invalid response$/, "$1 geçersiz bir yanıt gönderdi"],
    [/^Search (.+) or enter address$/, "$1 ile arayın veya adres girin"],
    [/^Search (Google|Bing|DuckDuckGo|Brave Search|Brave|the web)$/, "$1 ile ara"],
    [/^Search (.+) for “(.+)”$/, "$1 ile “$2” için ara"],
    [/^the web$/, "web"],
    [/^Home opens (.+)$/, "Ana sayfa $1 adresini açar"],
    [/^(\d+) s left$/, "$1 sn kaldı"], [/^(\d+) min left$/, "$1 dk kaldı"], [/^(\d+) h (\d+) min left$/, "$1 sa $2 dk kaldı"],
    [/^Paused · (.+) of (.+)$/, "Duraklatıldı · $1 / $2"], [/^Paused · (.+)$/, "Duraklatıldı · $1"],
    [/^([\d.]+ [KMGT]?B) of ([\d.]+ [KMGT]?B)$/, "$1 / $2"],
    [/^Canceled · (.*)$/, "İptal edildi · $1"], [/^Deleted · (.*)$/, "Silindi · $1"], [/^Failed · (.*)$/, "Başarısız · $1"],
    [/^Open (.+\.\w{1,5})$/, "$1 dosyasını aç"],
    [/^(\d+) downloading(.*)$/, "$1 indiriliyor$2"], [/^ · (\d+) paused$/, " · $1 duraklatıldı"], [/^(.+) · (\d+) paused$/, "$1 · $2 duraklatıldı"],
    [/^Downloads: (\d+) in progress(.*) \(Ctrl\+J\)$/, "İndirilenler: $1 sürüyor$2 (Ctrl+J)"],
    [/^· (\d+) more waiting$/, "· $1 tane daha bekliyor"],
    [/^(.+) says$/, "$1 diyor ki"],
    [/^Sign in to (.+)$/, "$1 oturumu açın"],
    [/^“(.+)” asks for your user name and password\.$/, "“$1” kullanıcı adınızı ve şifrenizi istiyor."],
    [/^Add “(.+)”\?$/, "“$1” eklensin mi?"],
    [/^From Edge Add-ons\. It will be able to:$/, "Edge Eklentileri'nden. Şunları yapabilecek:"],
    [/^From the Chrome Web Store\. It will be able to:$/, "Chrome Web Mağazası'ndan. Şunları yapabilecek:"],
    [/^Share your screen with (.+)$/, "Ekranınızı $1 ile paylaşın"],
    [/^Open (.+)\?$/, "$1 açılsın mı?"],
    [/^(.+) wants to open this link in an app on your PC\.$/, "$1 bu bağlantıyı bilgisayarınızdaki bir uygulamada açmak istiyor."],
    [/^Always let (.+) open (.+) links$/, "$1 her zaman $2 bağlantılarını açabilsin"],
    [/^(\d+) sites? with saved answers$/, "Kayıtlı yanıtı olan $1 site"],
    [/^Version (.+) · built on Chromium (.+)$/, "Sürüm $1 · Chromium $2 tabanlı"], [/^Version (.*)$/, "Sürüm $1"],
    [/^Drift plus (\d+) web engine processes$/, "Drift ve $1 web motoru işlemi"],
    [/^([\d.,]+) pages$/, "$1 sayfa"],
    [/^Web engine: (.+)$/, "Web motoru: $1"], [/^Operating system: (.+)$/, "İşletim sistemi: $1"], [/^User agent: (.+)$/, "Kullanıcı aracısı: $1"],
    [/^On · (.+) rules from (\d+) lists · (.+) blocked so far$/, "Açık · $2 listeden $1 kural · şimdiye kadar $3 engellendi"],
    [/^(.+) was added\.$/, "$1 eklendi."], [/^Drift couldn't add it: (.+)$/, "Drift bunu ekleyemedi: $1"],
    [/^(.+) \(turned off\)$/, "$1 (kapalı)"],
    [/^([\d.,]+) pages? · ([\d.,]+) bookmarks?$/, "$1 sayfa · $2 yer imi"],
    [/^Couldn't import from (.+): (.+)$/, "$1 tarayıcısından içe aktarılamadı: $2"],
    [/^([\d.,]+) pages? of history \(([\d.,]+) new\)$/, "$1 geçmiş sayfası ($2 yeni)"], [/^([\d.,]+) pages? of history$/, "$1 geçmiş sayfası"],
    [/^([\d.,]+) bookmarks? \(([\d.,]+) new\)$/, "$1 yer imi ($2 yeni)"], [/^([\d.,]+) bookmarks?$/, "$1 yer imi"],
    [/^From (Google Chrome|Microsoft Edge|Firefox|Brave|Opera GX|Opera|Vivaldi|Chromium)( (.+))?$/, "$1$2 tarayıcısından"],
    [/^Imported from (.+)$/, "$1 tarayıcısından içe aktarıldı"],
    [/^Drift (.+) is ready\. Restart to update\.$/, "Drift $1 hazır. Güncellemek için yeniden başlatın."],
    [/^Downloading Drift (.+)…$/, "Drift $1 indiriliyor…"], [/^Drift (.+) is ready$/, "Drift $1 hazır"], [/^Drift (.+) is out$/, "Drift $1 çıktı"],
    [/^Unreadable version (.+)$/, "Okunamayan sürüm $1"],
    [/^(\d+) ads and trackers blocked on this page$/, "Bu sayfada $1 reklam ve izleyici engellendi"],
    [/^([\d.,]+) (?:ad or tracker|ads and trackers) blocked$/, "$1 reklam ve izleyici engellendi"],
    [/^Block ads on (.+)$/, "$1 üzerinde reklamları engelle"], [/^on (.+)$/, "$1 üzerinde"],
    [/^You turned blocking off for (.+)\.$/, "$1 için engellemeyi kapattınız."],
    [/^([\d.,]+) blocked in total · ([\d.,]+) rules from (\d+) lists$/, "Toplam $1 engellendi · $3 listeden $2 kural"],
    [/^(\d+) min ago$/, "$1 dk önce"], [/^today at (.+)$/, "bugün $1"],
    [/^Couldn't update · using the copy from (.+)$/, "Güncellenemedi · $1 tarihli kopya kullanılıyor"],
    [/^([\d.,]+) rules · updated (.+)$/, "$1 kural · $2 güncellendi"], [/^Off · last updated (.+)$/, "Kapalı · son güncelleme $1"],
    [/^([\d.,]+) rules from (\d+) lists \(([\d.,]+) blocking, ([\d.,]+) hiding\)$/, "$2 listeden $1 kural ($3 engelleme, $4 gizleme)"],
    [/^(\d+) downloads are still in progress\. Close Drift and cancel them\?$/, "$1 indirme hâlâ sürüyor. Drift kapatılıp indirmeler iptal edilsin mi?"],
    [/^(\d+) tabs$/, "$1 sekme"], [/^Downloading (.+)$/, "$1 indiriliyor"], [/^Off on (.+)$/, "$1 üzerinde kapalı"], [/^(\d+) blocked$/, "$1 engellendi"],
    [/^Let Drift reach (.+)\?$/, "Drift $1 adresine ulaşsın mı?"], [/^Version (.+) · Chromium (.+)$/, "Sürüm $1 · Chromium $2"],
    [/^([\d.,]+) rules$/, "$1 kural"], [/^([\d.,]+ [KMGT]?B) of ([\d.,]+ [KMGT]?B)$/, "$1 / $2"],
    // last: text joined with " · " is translated piece by piece
    [/^(.+?) · (.+)$/, "$1 · $2"],
  ];

  const tables = { tr: [TR, TR_PATTERNS] };

  function make(lang) {
    const table = tables[lang];
    function find(s) {
      if (!table || !s || !/[A-Za-z]/.test(s)) return null;
      if (Object.prototype.hasOwnProperty.call(table[0], s)) return table[0][s];
      for (const [re, to] of table[1]) {
        const m = s.match(re);
        if (m) return to.replace(/\$(\d)/g, (_, i) => { const g = m[+i] || ""; const t = find(g); return t == null ? g : t; });
      }
      return null;
    }
    /** Translates `s`; {name} placeholders are filled from `vars` afterwards. */
    function T(s, vars) {
      let r = find(s);
      if (r == null) r = s;
      return vars ? r.replace(/\{(\w+)\}/g, (m, k) => k in vars ? vars[k] : m) : r;
    }
    return { lang: table ? lang : "en", T, find, locale: lang === "tr" ? "tr-TR" : "en-US" };
  }

  if (typeof module === "object" && module.exports) { module.exports = { make, languages: ["en", "tr"] }; return; }

  // ---------- in a page ----------
  // Drift for Android serves its pages from https://drift.local and keeps the choice in this origin's storage instead
  let lang = document.documentElement.lang || "en";
  if (location.host === "drift.local") {
    let chosen = null;
    try { chosen = localStorage.getItem("drift-lang"); } catch { }
    lang = chosen && chosen !== "system" ? chosen : navigator.language || "en";
  }
  const I = make(lang.slice(0, 2).toLowerCase());
  root.T = I.T;
  root.LANG = I.lang;
  root.LOCALE = I.locale;
  document.documentElement.lang = I.lang;   // capitals follow the language too: "dil" becomes "DİL"

  // dates and numbers follow the chosen language when the computer's is a different one (English on a Turkish PC)
  if (!(navigator.language || "").toLowerCase().startsWith(I.lang))
    for (const [P, keys] of [[Number.prototype, ["toLocaleString"]], [Date.prototype, ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"]]])
      for (const k of keys) {
        const f = P[k];
        P[k] = function (loc, opt) { return f.call(this, loc == null || (Array.isArray(loc) && !loc.length) ? I.locale : loc, opt); };
      }
  if (I.lang === "en") return;

  // what people and websites wrote stays as it is: tab and page titles, addresses, file names, a site's own message
  const Keep = "script, style, textarea, [translate=no], .ttl, .rt b, .ht, .hh, #addrText .host, #addrText .path, #jdMsg, .srow .d, .dname, .pmhost, .swhead span, .toast .host, .toast .title, .toast .body, .exrow .ext b, #q, .site .name";
  const Attrs = ["title", "placeholder", "aria-label"];

  function text(node) {
    const v = node.nodeValue, key = v.trim();
    if (!key) return;
    const p = node.parentElement;
    if (!p || p.closest(Keep)) return;
    const t = I.find(key.replace(/\s+/g, " "));
    if (t != null && t !== key) node.nodeValue = v.slice(0, v.indexOf(key)) + t + v.slice(v.indexOf(key) + key.length);
  }
  function attrs(el) {
    if (el.closest(Keep)) return;
    for (const a of Attrs) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const t = I.find(v.trim());
      if (t != null && t !== v) el.setAttribute(a, t);
    }
  }
  function walk(node) {
    if (node.nodeType === 3) { text(node); return; }
    if (node.nodeType !== 1) return;
    attrs(node);
    const w = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) text(n); else attrs(n); }
  }
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(walk);
      else if (m.type === "characterData") text(m.target);
      else if (m.type === "attributes") attrs(m.target);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: Attrs });
  document.addEventListener("DOMContentLoaded", () => walk(document.documentElement));
})(this);
