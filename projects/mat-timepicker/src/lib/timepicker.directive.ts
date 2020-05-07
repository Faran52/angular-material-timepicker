import { ControlValueAccessor, NgForm, NgControl, FormGroupDirective, FormControl } from '@angular/forms';
import {
  Directive,
  OnInit,
  EventEmitter,
  Input,
  ElementRef,
  OnChanges,
  Renderer2,
  AfterViewInit,
  OnDestroy,
  Optional,
  SimpleChanges,
  NgZone,
  HostBinding,
  Self,
  Output,
  HostListener
} from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldControl, MatFormField } from '@angular/material/form-field';
import { ClockMode, IAllowed24HourMap, IAllowed12HourMap } from './interfaces-and-types';
import { twoDigits, convertHoursForMode, isAllowed, isDateInRange, isTimeInRange } from './util';
import { MatTimepickerComponentDialogComponent } from './timepicker-dialog/timepicker-dialog.component';
import { Subject } from 'rxjs';
import { takeUntil, first } from 'rxjs/operators';
import { FocusMonitor } from '@angular/cdk/a11y';
import { coerceBooleanProperty } from '@angular/cdk/coercion';
import { ErrorStateMatcher } from '@angular/material/core';

@Directive({
  selector: 'input[matTimepicker]',
  providers: [
    { provide: MatFormFieldControl, useExisting: MatTimepickerDirective }
  ],
  // tslint:disable-next-line:no-host-metadata-property
  host: {
    /**
     * @breaking-change 8.0.0 remove .mat-form-field-autofill-control in favor of AutofillMonitor.
     */
    // tslint:disable-next-line:object-literal-key-quotes
    'class': 'mat-input-element mat-form-field-autofill-control',
    '[class.mat-input-server]': '_isServer',
    // Native input properties that are overwritten by Angular inputs need to be synced with
    // the native input element. Otherwise property bindings for those don't work.
    '[attr.id]': 'id',
    '[attr.placeholder]': 'placeholder',
    '[disabled]': 'disabled',
    '[required]': 'required',
    '[attr.readonly]': 'readonly && !_isNativeSelect || null',
    '[attr.aria-describedby]': '_ariaDescribedby || null',
    '[attr.aria-invalid]': 'errorState',
    '[attr.aria-required]': 'required.toString()',
  },
  exportAs: 'matTimepicker'
})
export class MatTimepickerDirective implements
  OnInit,
  OnChanges,
  AfterViewInit,
  OnDestroy,
  ControlValueAccessor,
  MatFormFieldControl<any>
{
  static nextId = 0;

  // tslint:disable-next-line:variable-name
  _errorState = false;
  get errorState() {
    const oldState = this._errorState;
    const parent = this._parentFormGroup || this._parentForm;
    const control = this.ngControl ? this.ngControl.control as FormControl : null;
    const newState = this.errorStateMatcher ? this.errorStateMatcher.isErrorState(control, parent) : oldState;

    if (newState !== oldState) {
      this._errorState = newState;
      this.stateChanges.next();
    }

    return newState;
  }

  private isAlive: Subject<any> = new Subject<any>();
  stateChanges = new Subject<void>();

  @HostBinding() id = `example-tel-input-${MatTimepickerDirective.nextId++}`;
  @HostBinding('class.floating') get shouldLabelFloat() { return this.focused || !this.empty; }
  @HostBinding('attr.aria-describedby') describedBy = '';

  @Input() errorStateMatcher: ErrorStateMatcher;

  @Input()
  get required() {
    return this._required;
  }
  set required(req) {
    this._required = coerceBooleanProperty(req);
    this.stateChanges.next();
  }
  // tslint:disable-next-line:variable-name
  private _required = false;


  @Input()
  get disabled(): boolean { return this._disabled; }
  set disabled(value: boolean) {
    this._disabled = coerceBooleanProperty(value);
    this.stateChanges.next();
  }
  // tslint:disable-next-line:variable-name
  private _disabled = false;


  @Input()
  get placeholder() {
    return this._placeholder;
  }
  set placeholder(plh) {
    this._placeholder = plh;
    this.stateChanges.next();
  }
  // tslint:disable-next-line:variable-name
  private _placeholder: string;

  focused = false;
  private pattern: RegExp;

  private allowed24HourMap: IAllowed24HourMap = null;
  private allowed12HourMap: IAllowed12HourMap = null;

  private isInputFocused = false;

  // tslint:disable-next-line:variable-name
  private _isActive = false;
  private set isActive(value) {
    if (this._isActive === value) { return; }
    this._isActive = value;
    const target = this._matFormFiled ? this._matFormFiled._elementRef.nativeElement : this.elRef.nativeElement;
    if (value) {
      this.renderer.addClass(target, 'mat-focused');
      return;
    }
    this.renderer.removeClass(target, 'mat-focused');
  }

  /** Override the label of the ok button. */
  @Input() okLabel = 'Ok';
  /** Override the label of the cancel button. */
  @Input() cancelLabel = 'Cancel';

  /** Sets the clock mode, 12-hour or 24-hour clocks are supported. */
  @Input() mode: ClockMode = '24h';
  @Input() color = 'primary';
  @Input() disableDialogOpenOnClick = false;
  @Input() strict = true;

  controlType = 'angular-material-timepicker';

  private listeners: (() => void)[] = [];

  @Input() minDate: Date;
  @Input() maxDate: Date;

  // tslint:disable-next-line:variable-name
  private _isPm: boolean;
  // tslint:disable-next-line:variable-name
  private _value: Date;
  // tslint:disable-next-line:variable-name
  private _formattedValueString: string;

  // tslint:disable-next-line:variable-name
  private _skipValueChangeEmission = true;

  @Input() set value(value: Date) {
    if (value === this._value) { return; }
    this._value = value;
    if (!value) {
      this._formattedValueString = null;
      this.setInputElementValue(value);
      this.currentValue = value;
      return;
    }

    const { hour, isPm } = convertHoursForMode(value.getHours(), this.mode);
    this._isPm = isPm;
    this._formattedValueString = this.mode === '12h' ?
      `${hour}:${twoDigits(value.getMinutes())} ${isPm ? 'pm' : 'am'}` :
      `${twoDigits(value.getHours())}:${twoDigits(value.getMinutes())}`;

    if (!this.isInputFocused) { this.setInputElementValue(this.formattedValueString); }
    this.currentValue = value;
    this.stateChanges.next();

    if (this._skipValueChangeEmission) { return; }
    this.timeChange.emit(this.currentValue);
  }

  get value() { return this._value; }

  get isPm() { return this._isPm; }

  get empty() {
    return !(this.currentValue instanceof Date);
  }

  private get formattedValueString() { return this._formattedValueString; }

  private currentValue: Date;
  private modalRef: MatDialogRef<MatTimepickerComponentDialogComponent>;

  private onChangeFn: any;
  private onTouchedFn: any;
  private combination: string[] = [];

  @Output() timeChange: EventEmitter<any> = new EventEmitter<any>();
  @Output() invalidInput: EventEmitter<any> = new EventEmitter<any>();

  @HostListener('input', ['$event']) inputHandler() {
    let value = (this.elRef.nativeElement as any).value as string;
    const length = value.length;
    if (length === 0) {
      this.writeValue(null, true);
      if (this.onChangeFn) { this.onChangeFn(null); }
      return;
    }

    const meridiemResult = value.match(/am|pm/i);
    let meridiem: string | null = null;
    if (meridiemResult) {
      value = value.replace(meridiemResult[0], '');
      [meridiem] = meridiemResult;
    }
    const valueHasColumn = value.includes(':');
    let [hours, minutes]: any = length === 1 ? [value, 0] :
      length === 2 && !valueHasColumn ? [value, 0] : valueHasColumn ? value.split(':') : value.split(/(\d\d)/).filter(v => v);

    hours = +hours;

    if (/\s/.test(minutes)) {
      let other;
      [minutes, other] = minutes.split(/\s/);
      if (other === 'pm' && !isNaN(hours) && hours < 12) { hours += 12; }
    }

    minutes = +minutes;

    if (isNaN(hours) || isNaN(minutes)) {
      this.writeValue(null, true); return;
    }

    if (hours < 12 && meridiem && meridiem.toLowerCase() === 'pm') {
      hours += 12;
    } else if (hours > 12 && meridiem && meridiem.toLowerCase() === 'am') {
      hours -= 12;
    }

    if (this.mode === '12h' && +hours < 1) {
      hours = '1';
    } else {
      if (+hours > 24) {
        hours = '24';
      } else if (+hours < 0) {
        hours = '0';
      }
    }


    if (+minutes > 59) {
      minutes = '59';
    } else if (+minutes < 0) {
      minutes = '0';
    }

    const d = this.value ? new Date(this.value.getTime()) : new Date();
    d.setHours(+hours);
    d.setMinutes(+minutes);
    d.setSeconds(0);
    d.setMilliseconds(0);

    const isValueInRange = isDateInRange(this.minDate, this.maxDate, d);
    if (!isValueInRange) { this.invalidInput.emit(); }


    this.writeValue(d, true);
    if (this.onChangeFn) { this.onChangeFn(d); }
  }

  @HostListener('keydown', ['$event']) keydownHandler(event: any) {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      this.combination = this.combination.concat(event.code);
      return;
    }
    if (!/^[0-9a-zA-Z\s]{0,1}$/.test(event.key)) { return; }
    const target = event.target;
    const tValue = target.value;
    const value = `${tValue.slice(0, target.selectionStart)}${event.key}${tValue.slice(target.selectionEnd)}`;
    if (value.match(this.pattern) || this.combination.length > 0) { return true; }
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  @HostListener('keyup', ['$event']) keyupHandler(event: any) {
    this.combination = this.combination.filter(v => v !== event.code);
  }

  @HostListener('focus', ['$event']) focusHandler() {
    this.isInputFocused = true;
    this.isActive = true;
  }

  @HostListener('focusout', ['$event']) focusoutHandler() {
    this.isInputFocused = false;
    this.isActive = false;
    this.setInputElementValue(this.formattedValueString);
    if (this.onTouchedFn && this.disableDialogOpenOnClick) { this.onTouchedFn(); }
  }

  constructor(
    @Optional() @Self() public ngControl: NgControl,
    public dialog: MatDialog,
    private renderer: Renderer2,
    private zone: NgZone,
    private fm: FocusMonitor,
    private elRef: ElementRef<HTMLElement>,
    // tslint:disable-next-line:variable-name
    @Optional() private _parentForm: NgForm,
    // tslint:disable-next-line:variable-name
    @Optional() private _matFormFiled: MatFormField,
    // tslint:disable-next-line:variable-name
    @Optional() private _parentFormGroup: FormGroupDirective,
    // tslint:disable-next-line:variable-name
    _defaultErrorStateMatcher: ErrorStateMatcher,
  ) {
    this.errorStateMatcher = _defaultErrorStateMatcher;
    if (this.ngControl != null) { this.ngControl.valueAccessor = this; }

    fm.monitor(elRef.nativeElement, true).subscribe(origin => {
      this.focused = !!origin;
      this.stateChanges.next();
    });
  }

  setDescribedByIds(ids: string[]) {
    this.describedBy = ids.join(' ');
  }

  onContainerClick(event: MouseEvent) {
    if ((event.target as Element).tagName.toLowerCase() !== 'input') {
      this.elRef.nativeElement.focus();
    }
  }

  setInputElementValue(value: any) {
    Promise.resolve().then(() => {
      this.zone.runOutsideAngular(() => {
        this.renderer.setProperty(this.elRef.nativeElement, 'value', value);
      });
    });
  }

  validate() {
    const isValueInRange = this.strict ?
      isDateInRange(this.minDate, this.maxDate, this.currentValue) :
      isTimeInRange(this.minDate, this.maxDate, this.currentValue);

    return isValueInRange ? null : { dateRange: true };
  }

  ngAfterViewInit() {
    this.listeners.push(
      this.renderer.listen(
        this._matFormFiled ? this._matFormFiled._elementRef.nativeElement : this.elRef.nativeElement
        , 'click', this.clickHandler)
    );
  }

  clickHandler = (e: FocusEvent) => {
    if ((this.modalRef && this.modalRef.componentInstance.isClosing) || this.disabled || this.disableDialogOpenOnClick) { return; }
    if (!this.modalRef && !this.disableDialogOpenOnClick) { this.showDialog(); }
  }

  ngOnInit() {
    if (!this.value) {
      const hasMaxDate = !!this.maxDate;
      const hasMinDate = !!this.minDate;

      if (hasMinDate || hasMaxDate) {
        if (hasMinDate) { this.minDate.setSeconds(0); this.minDate.setMilliseconds(0); }
        if (hasMaxDate) { this.maxDate.setSeconds(0); this.maxDate.setMilliseconds(0); }
        Promise.resolve().then(() => this.generateAllowedMap());

        if (!(this.ngControl as any)._rawValidators.find(v => v === this)) {
          (this.ngControl as any)._rawValidators.push(this);
        }
      }
    }
    this._skipValueChangeEmission = false;
  }

  generateAllowedMap() {
    const isStrictMode = this.strict && this.value instanceof Date;
    if (this.mode === '24h') {
      this.allowed24HourMap = {};
      for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m++) {
          const hourMap = this.allowed24HourMap[h] || {};
          if (isStrictMode) {
            const currentDate = new Date(this.value.getTime());
            currentDate.setHours(h);
            currentDate.setMinutes(m);
            currentDate.setSeconds(0);
            currentDate.setMilliseconds(0);
            hourMap[m] = isDateInRange(this.minDate, this.maxDate, currentDate);
          } else {
            hourMap[m] = isAllowed(h, m, this.minDate, this.maxDate, '24h');
          }
          this.allowed24HourMap[h] = hourMap;
        }
      }
    } else {
      this.allowed12HourMap = { am: {}, pm: {} };
      for (let h = 0; h < 24; h++) {
        const meridiem = h < 12 ? 'am' : 'pm';
        for (let m = 0; m < 60; m++) {
          const hour = (h > 12 ? h - 12 : h === 0 ? 12 : h);
          const hourMap = this.allowed12HourMap[meridiem][hour] || {};
          if (isStrictMode) {
            const currentDate = new Date(this.value.getTime());
            currentDate.setHours(h);
            currentDate.setMinutes(m);
            currentDate.setSeconds(0);
            currentDate.setMilliseconds(0);
            hourMap[m] = isDateInRange(this.minDate, this.maxDate, currentDate);
          } else {
            hourMap[m] = isAllowed(h, m, this.minDate, this.maxDate, '24h');
          }
          this.allowed12HourMap[meridiem][hour] = hourMap;
        }
      }
    }
  }

  ngOnChanges(simpleChanges: SimpleChanges) {

    this.pattern = this.mode === '24h' ? /^[0-9]{1,2}:?([0-9]{1,2})?$/ : /^[0-9]{1,2}:?([0-9]{1,2})?\s?(a|p)?m?$/;

    if (
      (simpleChanges.minDate && !simpleChanges.minDate.isFirstChange &&
        +simpleChanges.minDate.currentValue !== simpleChanges.minDate.previousValue) ||
      (simpleChanges.maxDate && !simpleChanges.maxDate.isFirstChange &&
        +simpleChanges.maxDate.currentValue !== simpleChanges.maxDate.previousValue) ||
      (simpleChanges.disableLimitBase && !simpleChanges.disableLimitBase.isFirstChange &&
        +simpleChanges.disableLimitBase.currentValue !== simpleChanges.disableLimitBase.previousValue)
    ) { this.generateAllowedMap(); }

    if (!this.modalRef || !this.modalRef.componentInstance) { return; }

    this.modalRef.componentInstance.data = {
      mode: this.mode,
      value: this.currentValue,
      okLabel: this.okLabel,
      cancelLabel: this.cancelLabel,
      color: this.color,
      isPm: this.isPm,
      minDate: this.minDate,
      maxDate: this.maxDate,
      allowed12HourMap: this.allowed12HourMap,
      allowed24HourMap: this.allowed24HourMap
    };
  }

  checkValidity(value: Date) {
    if (!value) { return false; }
    const hour = value.getHours();
    const minutes = value.getMinutes();
    const meridiem = this.isPm ? 'PM' : 'AM';
    return isAllowed(hour, minutes, this.minDate, this.maxDate, this.mode, meridiem);
  }

  writeValue(value: Date, isInnerCall = false): void {

    if (!isInnerCall) {
      this._skipValueChangeEmission = true;
      Promise.resolve().then(() => this._skipValueChangeEmission = false);
    }

    if (value) {
      value.setSeconds(0);
      value.setMilliseconds(0);
    }

    if (+this.value !== +value) { this.value = value; }
  }

  registerOnChange(fn: any): void {
    this.onChangeFn = fn;
  }

  registerOnTouched(fn: any): void {
    this.onTouchedFn = fn;
  }

  setDisabledState?(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  showDialog() {
    if (this.disabled) { return; }
    this.isInputFocused = false;
    setTimeout(() => this.isActive = true); // set isActive after the focusout is fired
    this.modalRef = this.dialog.open(MatTimepickerComponentDialogComponent, {
      autoFocus: false,
      data: {
        mode: this.mode,
        value: this.currentValue,
        okLabel: this.okLabel,
        cancelLabel: this.cancelLabel,
        color: this.color,
        isPm: this.isPm,
        minDate: this.minDate,
        maxDate: this.maxDate,
        allowed12HourMap: this.allowed12HourMap,
        allowed24HourMap: this.allowed24HourMap
      }
    });
    const instance = this.modalRef.componentInstance;
    instance.changeEvent.pipe(takeUntil(this.isAlive)).subscribe(this.handleChange);
    instance.okClickEvent.pipe(takeUntil(this.isAlive)).subscribe(this.handleOk);
    instance.cancelClickEvent.pipe(takeUntil(this.isAlive)).subscribe(this.handleCancel);
    this.modalRef.beforeClosed().pipe(first()).subscribe(() => instance.isClosing = true);
    this.modalRef.afterClosed().pipe(first()).subscribe(() => {
      if (this.onTouchedFn) { this.onTouchedFn(); }
      this.modalRef = null;
      this.elRef.nativeElement.focus();
    });

    this.currentValue = this.value as Date;
  }

  handleChange = (newValue) => {
    if (!(newValue instanceof Date)) { return; }
    const v = this.value instanceof Date ? new Date(this.value.getTime()) : new Date();
    v.setHours(newValue.getHours());
    v.setMinutes(newValue.getMinutes());
    v.setSeconds(0);
    v.setMilliseconds(0);
    this.currentValue = v;
  }

  handleOk = () => {
    if (this.onChangeFn) { this.onChangeFn(this.currentValue); }
    this.value = this.currentValue;
    this.modalRef.close();
  }

  handleCancel = () => {
    this.modalRef.close();
  }

  ngOnDestroy() {
    this.isAlive.next();
    this.isAlive.complete();
    this.stateChanges.complete();
    this.fm.stopMonitoring(this.elRef.nativeElement);

    this.listeners.forEach(l => l());
  }
}
