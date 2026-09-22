package com.ahuva.itsupport;

import android.os.Bundle;
import com.ahuva.itsupport.plugins.AhuvaNetworkPlugin;
import com.ahuva.itsupport.plugins.AhuvaSessionPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(AhuvaSessionPlugin.class);
        registerPlugin(AhuvaNetworkPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
