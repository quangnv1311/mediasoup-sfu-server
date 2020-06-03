import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { AppComponent } from './app.component';
import { SubcribeComponent } from './subcribe/subcribe.component';
import { LivestreamComponent } from './livestream/livestream.component';
import { HomeComponent } from './home/home.component';

const routes: Routes = [
  {path: '', component: HomeComponent},
  {path: 'subcribe', component: SubcribeComponent},
  {path: 'livestream', component: LivestreamComponent},
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule { }
