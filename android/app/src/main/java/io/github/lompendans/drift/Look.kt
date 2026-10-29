package io.github.lompendans.drift

import android.graphics.Color
import java.util.Locale

/** The language and accent color Drift shows natively (dialogs, toasts). Its pages translate themselves with ui/i18n.js. */
object Look {
    var lang = "en"
    var accent = "teal"

    /** "system" follows the phone when it's a language Drift speaks. */
    fun setLanguage(choice: String) {
        lang = if (choice == "en" || choice == "tr") choice else if (Locale.getDefault().language == "tr") "tr" else "en"
    }

    // [light theme, dark theme], the same as desktop Drift
    private val accents = mapOf(
        "teal" to ("#0d9a87" to "#35c9b1"), "blue" to ("#2563eb" to "#5b9cff"), "purple" to ("#7c3aed" to "#a78bfa"),
        "pink" to ("#db2777" to "#f472b6"), "orange" to ("#ea580c" to "#fb923c"), "graphite" to ("#4b5563" to "#a1a7b3"),
    )
    val accentNames get() = accents.keys
    fun accentColor(dark: Boolean): Int = Color.parseColor((accents[accent] ?: accents.getValue("teal")).let { if (dark) it.second else it.first })

    private val tr = mapOf(
        "New Tab" to "Yeni Sekme", "This page" to "Bu sayfa", "Leave site?" to "Siteden ayrılınsın mı?",
        "Changes you made may not be saved." to "Yaptığınız değişiklikler kaydedilmeyebilir.",
        "Stay" to "Kal", "Leave" to "Ayrıl", "Cancel" to "İptal", "OK" to "Tamam",
        "Drift can't reach your local network without it" to "Drift bu izin olmadan yerel ağınıza ulaşamaz",
        "Opened in a new tab" to "Yeni sekmede açıldı", "No app can open this link" to "Bu bağlantıyı açabilecek uygulama yok",
        "Copied" to "Kopyalandı", "Drift can't save this kind of download yet" to "Drift bu tür indirmeleri henüz kaydedemiyor",
        "Couldn't start the download" to "İndirme başlatılamadı", "No app can open this file" to "Bu dosyayı açabilecek uygulama yok",
        "The file isn't there anymore" to "Dosya artık orada değil",
    )
    fun t(s: String) = if (lang == "tr") tr[s] ?: s else s
    fun says(host: String) = if (lang == "tr") "$host diyor ki" else "$host says"
}
