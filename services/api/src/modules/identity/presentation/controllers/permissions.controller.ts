import { asPermissionId, asUserId, type UserId } from '@iecp/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { ClearPermissionOverrideUseCase } from '../../application/rbac/clear-permission-override.usecase';
import { GetEffectivePermissionsUseCase } from '../../application/rbac/get-effective-permissions.usecase';
import { ListPermissionsUseCase } from '../../application/rbac/list-permissions.usecase';
import { SetPermissionOverrideUseCase } from '../../application/rbac/set-permission-override.usecase';
import { CurrentUserId } from '../decorators/current-user.decorator';
import { RequireModule } from '../decorators/require-module.decorator';
import { RequirePermission } from '../decorators/require-permission.decorator';
import {
  EffectivePermissionsResponseDto,
  PermissionResponseDto,
  SetPermissionOverrideDto,
} from '../dto/permission.dto';

/** blueprint §53's "permission matrix" (the read-only registry) and
 * per-user allow/deny exceptions. */
@ApiTags('permissions')
@Controller()
export class PermissionsController {
  constructor(
    private readonly listPermissions: ListPermissionsUseCase,
    private readonly getEffectivePermissions: GetEffectivePermissionsUseCase,
    private readonly setOverride: SetPermissionOverrideUseCase,
    private readonly clearOverride: ClearPermissionOverrideUseCase,
  ) {}

  @Get('permissions')
  @RequireModule('identity')
  @ApiOkResponse({ type: [PermissionResponseDto] })
  async list(): Promise<PermissionResponseDto[]> {
    const permissions = await this.listPermissions.execute();
    return permissions.map((permission) => PermissionResponseDto.fromDomain(permission));
  }

  /** No permission gate beyond authentication — every user may see their
   * own resolved permission set (role inheritance + overrides applied). */
  @Get('me/permissions')
  @ApiOkResponse({ type: EffectivePermissionsResponseDto })
  async mine(@CurrentUserId() userId: UserId): Promise<EffectivePermissionsResponseDto> {
    const effective = await this.getEffectivePermissions.execute(userId);
    return EffectivePermissionsResponseDto.fromSet(effective);
  }

  @Post('users/:userId/permission-overrides')
  @RequirePermission('identity.permissions.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setOverrideForUser(
    @CurrentUserId() actorId: UserId,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: SetPermissionOverrideDto,
  ): Promise<void> {
    await this.setOverride.execute({
      userId: asUserId(userId),
      permissionId: asPermissionId(dto.permissionId),
      effect: dto.effect,
      reason: dto.reason,
      createdBy: actorId,
    });
  }

  @Delete('users/:userId/permission-overrides/:permissionId')
  @RequirePermission('identity.permissions.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clearOverrideForUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ): Promise<void> {
    await this.clearOverride.execute(asUserId(userId), asPermissionId(permissionId));
  }
}
