package com.projectsarathi.gpscamera;

import android.content.Context;
import android.graphics.Canvas;
import android.util.AttributeSet;
import android.view.View;

/** Live preview of the stamp, drawn over the camera preview with the same renderer as the photo. */
public class StampView extends View {

    private final StampRenderer renderer = new StampRenderer();
    private StampData data;

    public StampView(Context context) {
        super(context);
    }

    public StampView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public void setData(StampData data) {
        StampData old = this.data;
        this.data = data;
        if (old == null || getWidth() == 0
                || renderer.measureHeight(getWidth(), old) != renderer.measureHeight(getWidth(), data)) {
            requestLayout();
        }
        invalidate();
    }

    @Override
    protected void onMeasure(int widthMeasureSpec, int heightMeasureSpec) {
        int w = MeasureSpec.getSize(widthMeasureSpec);
        int h = data == null || w == 0 ? 0 : renderer.measureHeight(w, data);
        setMeasuredDimension(w, h);
    }

    @Override
    protected void onDraw(Canvas canvas) {
        if (data != null) renderer.draw(canvas, getWidth(), getHeight(), data);
    }
}
