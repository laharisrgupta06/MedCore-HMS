import { BullModule } from '@nestjs/bullmq';
import {
  Body,
  Global,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Appointment, DoctorSchedule, ScheduleException, Slot } from '@medcore/types';
import { Audit } from '../../common/audit/audit.decorators';
import { CurrentUser, Roles, type AuthPrincipal } from '../../common/auth/decorators';
import type { PaginatedResult } from '../../common/http/paginated-result';
import { QueueModule } from '../../infra/queue/queue.module';
import {
  BullReminderScheduler,
  APPOINTMENTS_QUEUE,
  ReminderProcessor,
  REMINDER_SCHEDULER,
} from './reminders';
import {
  BookDto,
  ExceptionDto,
  ExceptionsQuery,
  ListAppointmentsQuery,
  RescheduleDto,
  ScheduleDto,
  SlotsQuery,
  StatusDto,
  UpdateScheduleDto,
} from './scheduling.dto';
import { SchedulingService } from './scheduling.service';

const uuid = new ParseUUIDPipe({ version: '4' });
const STAFF_VIEW = ['HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'ACCOUNTANT'] as const;

@ApiTags('Availability')
@ApiBearerAuth()
@Controller()
export class AvailabilityController {
  constructor(private readonly s: SchedulingService) {}

  @Get('doctors/:id/schedules')
  @Roles(...STAFF_VIEW)
  @ApiOperation({ summary: 'Weekly availability windows (APPT-001)' })
  schedules(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<DoctorSchedule[]> {
    return this.s.schedules(a, id);
  }

  @Post('doctors/:id/schedules')
  @Roles('HOSPITAL_ADMIN', 'DOCTOR')
  @Audit('schedule.create', 'DoctorSchedule', ['weekday', 'startTime', 'endTime', 'slotMinutes'])
  @ApiOperation({ summary: 'Add a weekly window, e.g. 09:00 to 13:00 in 30-minute slots' })
  addSchedule(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: ScheduleDto,
  ): Promise<DoctorSchedule> {
    return this.s.addSchedule(a, id, dto);
  }

  @Patch('schedules/:id')
  @Roles('HOSPITAL_ADMIN', 'DOCTOR')
  @Audit('schedule.update', 'DoctorSchedule', ['isActive', 'validTo'])
  updateSchedule(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: UpdateScheduleDto,
  ): Promise<DoctorSchedule> {
    return this.s.updateSchedule(a, id, dto);
  }

  @Delete('schedules/:id')
  @Roles('HOSPITAL_ADMIN', 'DOCTOR')
  @Audit('schedule.delete', 'DoctorSchedule')
  removeSchedule(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.s.removeSchedule(a, id);
  }

  @Get('doctors/:id/exceptions')
  @Roles(...STAFF_VIEW)
  @ApiOperation({ summary: 'Leave, blocked time and extra hours' })
  exceptions(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Query() q: ExceptionsQuery,
  ): Promise<ScheduleException[]> {
    return this.s.exceptions(a, id, q.from);
  }

  @Post('doctors/:id/exceptions')
  @Roles('HOSPITAL_ADMIN', 'DOCTOR')
  @Audit('schedule_exception.create', 'ScheduleException', ['type', 'date'])
  addException(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: ExceptionDto,
  ): Promise<ScheduleException> {
    return this.s.addException(a, id, dto);
  }

  @Delete('exceptions/:id')
  @Roles('HOSPITAL_ADMIN', 'DOCTOR')
  @Audit('schedule_exception.delete', 'ScheduleException')
  removeException(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
  ): Promise<{ id: string; deleted: true }> {
    return this.s.removeException(a, id);
  }

  @Get('doctors/:id/slots')
  @Roles(...STAFF_VIEW, 'PATIENT')
  @ApiOperation({ summary: 'Bookable slots for a hospital-local date (cached 60 s, CACHE-002)' })
  slots(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Query() q: SlotsQuery,
  ): Promise<Slot[]> {
    return this.s.slots(a, id, q.date);
  }
}

@ApiTags('Appointments')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly s: SchedulingService) {}

  @Post()
  @Roles('PATIENT', 'RECEPTIONIST')
  @Audit('appointment.create', 'Appointment', ['type'])
  @ApiOperation({
    summary: 'Book a slot (API-016); reception may book EMERGENCY outside slots (APPT-004)',
  })
  book(@CurrentUser() a: AuthPrincipal, @Body() dto: BookDto): Promise<Appointment> {
    return this.s.book(a, dto);
  }

  @Get()
  @Roles(...STAFF_VIEW, 'PATIENT')
  @ApiOperation({
    summary: 'Appointments: patients see their own, doctors their own, staff the hospital',
  })
  list(
    @CurrentUser() a: AuthPrincipal,
    @Query() q: ListAppointmentsQuery,
  ): Promise<PaginatedResult<Appointment>> {
    return this.s.list(a, q);
  }

  @Get(':id')
  @Roles(...STAFF_VIEW, 'PATIENT')
  get(@CurrentUser() a: AuthPrincipal, @Param('id', uuid) id: string): Promise<Appointment> {
    return this.s.get(a, id);
  }

  @Patch(':id/status')
  @Roles('DOCTOR', 'RECEPTIONIST', 'HOSPITAL_ADMIN', 'PATIENT')
  @Audit('appointment.status', 'Appointment', ['status'])
  @ApiOperation({ summary: 'Status lifecycle (API-017, APPT-003); patients may cancel their own' })
  status(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: StatusDto,
  ): Promise<Appointment> {
    return this.s.setStatus(a, id, dto);
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @Roles('RECEPTIONIST', 'PATIENT')
  @Audit('appointment.reschedule', 'Appointment')
  @ApiOperation({ summary: 'Move an upcoming appointment to another slot of the same doctor' })
  reschedule(
    @CurrentUser() a: AuthPrincipal,
    @Param('id', uuid) id: string,
    @Body() dto: RescheduleDto,
  ): Promise<Appointment> {
    return this.s.reschedule(a, id, dto);
  }
}

/** Reminder queue wiring is separate so tests can replace it. */
@Global()
@Module({
  imports: [QueueModule, BullModule.registerQueue({ name: APPOINTMENTS_QUEUE })],
  providers: [
    BullReminderScheduler,
    ReminderProcessor,
    { provide: REMINDER_SCHEDULER, useExisting: BullReminderScheduler },
  ],
  exports: [REMINDER_SCHEDULER],
})
export class RemindersModule {}

@Module({
  controllers: [AvailabilityController, AppointmentsController],
  providers: [SchedulingService],
})
export class SchedulingModule {}
