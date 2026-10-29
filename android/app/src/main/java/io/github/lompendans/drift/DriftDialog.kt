package io.github.lompendans.drift

import android.app.Activity
import android.app.Dialog
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * A page's alert, confirm, prompt and "Leave site?" boxes, drawn by Android in Drift's style.
 * These can't be drawn by Drift's web interface: while a page waits for an answer, every web view in the app is
 * paused (they share one renderer), including Drift's own interface.
 */
object DriftDialog {
    fun show(activity: Activity, kind: String, host: String, message: String, text: String, answer: (Boolean, String?) -> Unit) {
        val dark = activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        val d = activity.resources.displayMetrics.density
        fun dp(v: Int) = (v * d).toInt()
        val fg = if (dark) Color.rgb(236, 236, 239) else Color.rgb(23, 25, 29)
        val muted = if (dark) Color.rgb(162, 166, 173) else Color.rgb(100, 106, 116)
        val pop = if (dark) Color.rgb(34, 35, 39) else Color.WHITE
        val soft = if (dark) Color.argb(18, 255, 255, 255) else Color.argb(15, 15, 23, 42)
        val accent = Look.accentColor(dark)
        fun round(color: Int, r: Int, stroke: Int = 0) = GradientDrawable().apply { setColor(color); cornerRadius = if (Look.square) 0f else dp(r).toFloat(); if (stroke != 0) setStroke(dp(1), stroke) }

        val title = when (kind) { "leave" -> Look.t("Leave site?"); else -> Look.says(host.ifEmpty { Look.t("This page") }) }
        val body = if (kind == "leave") Look.t("Changes you made may not be saved.") else message

        val dialog = Dialog(activity)
        var answered = false
        fun finish(ok: Boolean, value: String?) { if (answered) return; answered = true; dialog.dismiss(); answer(ok, value) }

        val box = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(22), dp(18), dp(16))
            background = round(pop, 22)
        }
        box.addView(TextView(activity).apply {
            this.text = title
            setTextColor(fg); setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f); typeface = Typeface.DEFAULT_BOLD
        })
        if (body.isNotEmpty()) box.addView(ScrollView(activity).apply {
            addView(TextView(activity).apply {
                this.text = body
                setTextColor(fg); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f); setTextIsSelectable(true)
                setLineSpacing(0f, 1.2f)
            })
        }, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        val input = if (kind == "prompt") EditText(activity).apply {
            setText(text); setSelection(0, text.length)
            setTextColor(fg); setHintTextColor(muted); setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            background = round(soft, 12); setPadding(dp(14), dp(10), dp(14), dp(10))
            inputType = InputType.TYPE_CLASS_TEXT; imeOptions = EditorInfo.IME_ACTION_DONE; isSingleLine = true
            setOnEditorActionListener { _, _, _ -> finish(true, this.text.toString()); true }
        } else null
        input?.let { box.addView(it, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(14) }) }

        val row = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END }
        fun button(label: String, primary: Boolean, onClick: () -> Unit) = Button(activity).apply {
            this.text = label
            isAllCaps = false; typeface = Typeface.DEFAULT_BOLD; setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
            setTextColor(if (primary) (if (dark) Color.rgb(6, 32, 28) else Color.WHITE) else fg)
            background = round(if (primary) accent else soft, 12)
            stateListAnimator = null
            minWidth = dp(76); minimumHeight = dp(42); setPadding(dp(18), 0, dp(18), 0)
            setOnClickListener { onClick() }
        }
        if (kind != "alert") row.addView(button(Look.t(if (kind == "leave") "Stay" else "Cancel"), false) { finish(false, null) }, LinearLayout.LayoutParams(-2, dp(42)))
        row.addView(button(Look.t(if (kind == "leave") "Leave" else "OK"), true) { finish(true, input?.text?.toString()) },
            LinearLayout.LayoutParams(-2, dp(42)).apply { marginStart = dp(8) })
        box.addView(row, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(20) })

        dialog.setContentView(box)
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(minOf(activity.resources.displayMetrics.widthPixels - dp(32), dp(440)), ViewGroup.LayoutParams.WRAP_CONTENT)
            setDimAmount(if (dark) 0.55f else 0.32f)
            if (input != null) setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE)
        }
        dialog.setOnCancelListener { finish(kind == "alert", null) }
        dialog.show()
        input?.requestFocus()
        if (kind == "leave" || kind == "confirm") (row.getChildAt(0) as View).requestFocus()
    }
}
