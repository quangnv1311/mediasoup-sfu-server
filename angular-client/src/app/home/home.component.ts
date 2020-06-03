import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss']
})
export class HomeComponent implements OnInit {
  title = 'angular-client';
  constructor(private router: Router) { }

  ngOnInit() {
  }

  goToLiveStream() {
    this.router.navigateByUrl('livestream');
  }

  goToSubcribe() {
    this.router.navigateByUrl('subcribe');
  }
}
