package com.projectsarathi.gpscamera;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import android.widget.FrameLayout;

/** A FrameLayout locked to a 3:4 (portrait) box so the preview matches the captured 4:3 photo. */
public class AspectFrameLayout extends FrameLayout {

    private static final float RATIO = 4f / 3f; // height / width

    public AspectFrameLayout(Context context) {
        super(context);
    }

    public AspectFrameLayout(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int availW = View.MeasureSpec.getSize(widthMeasureSpec);
        int availH = View.MeasureSpec.getSize(heightMeasureSpec);
        int w = availW;
        int h = Math.round(w * RATIO);
        if (View.MeasureSpec.getMode(heightMeasureSpec) != View.MeasureSpec.UNSPECIFIED && h > availH) {
            h = availH;
            w = Math.round(h / RATIO);
        }
        super.onMeasure(
                View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY));
    }
}
