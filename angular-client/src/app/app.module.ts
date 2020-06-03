import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

import { SocketIoModule, SocketIoConfig } from 'ngx-socket-io';
import { environment } from 'src/environments/environment';
import { SubcribeComponent } from './subcribe/subcribe.component';
import { LivestreamComponent } from './livestream/livestream.component';
import { HomeComponent } from './home/home.component';

const config: SocketIoConfig = { url: environment.ws, options: { transports: ["websocket"],autoConnect: false}};

@NgModule({
  declarations: [
    AppComponent,
    SubcribeComponent,
    LivestreamComponent,
    HomeComponent
  ],
  imports: [
    BrowserModule,
    AppRoutingModule,
    SocketIoModule.forRoot(config)
  ],
  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }
